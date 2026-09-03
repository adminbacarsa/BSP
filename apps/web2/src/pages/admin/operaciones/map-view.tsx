import React, { useState, useEffect, useMemo, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useOperacionesMonitor } from '@/hooks/useOperacionesMonitor';
import { POPUP_STYLES } from '@/components/operaciones/mapStyles';
import { toast } from 'sonner';
import { doc, updateDoc, serverTimestamp, addDoc, collection, query, where, orderBy, limit, Timestamp, setDoc, writeBatch, waitForPendingWrites, getDocs } from 'firebase/firestore';
import { db, onSnapshotFresh } from '@/lib/firebase';
import { getAuth } from 'firebase/auth';
import { useEmpresa } from '@/context/EmpresaContext';
import { stampEmpresaId, updateDocForEmpresa, shouldScopeQueriesToEmpresa } from '@/lib/multiempresa';
import { resolveTuraExtensionOperacionesTarget } from '@/lib/refuerzo/turaContiguity';

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
import { Radio, Filter, Search, Building2, Shield, Clock, Siren, CheckCircle, LogOut, AlertTriangle, Phone, MessageCircle, Calendar, Send, PlayCircle, EyeOff, Briefcase, X, UserCheck, Navigation, ChevronUp, ChevronDown, MapPin, BellRing, UserX, Users, XCircle, CornerUpLeft, Timer, AlarmClock, Loader2 } from 'lucide-react';
import { openWhatsApp, waMensaje } from '@/lib/whatsapp';
import { WorkedDayOffModal as WorkedDayOffModalPro } from '@/components/operaciones/OperationalModals';
import { WAComposeModal } from '@/components/common/WAComposeModal';

const OperacionesMap = dynamic(() => import('@/components/operaciones/OperacionesMap'), { loading: () => <div className="h-screen w-screen flex items-center justify-center bg-slate-900 text-slate-400 font-mono">CARGANDO MAPA TÁCTICO...</div>, ssr: false });

// --- HELPERS ---
const toDate = (d: any) => { if (!d) return new Date(); if (d instanceof Date) return d; if (d.seconds) return new Date(d.seconds * 1000); return new Date(d); };
const formatTimeSimple = (dateObj: any) => { try { return toDate(dateObj).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' }); } catch(e) { return '-'; } };
const formatTimeRange = (start: any, end: any) => { try { return `${toDate(start).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', timeZone:'America/Argentina/Cordoba'})} - ${toDate(end).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', timeZone:'America/Argentina/Cordoba'})}`; } catch { return '--:--'; } };
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
const HandoverModal = ({ isOpen, onClose, incomingShift, logic, recentlyRelievedIds, onRelieved }: any) => {
    if (!isOpen || !incomingShift) return null;
    const now = new Date(); const start = toDate(incomingShift.shiftDateObj); const diffMin = (now.getTime() - start.getTime()) / 60000;
    let status = 'ON_TIME'; if (!incomingShift.isReten && diffMin > 5) status = 'LATE';
    const activeGuards = logic.processedData.filter((s:any) => {
        if (s.objectiveId !== incomingShift.objectiveId) return false;
        if (s.positionName !== incomingShift.positionName) return false;
        if (!(s.isPresent || s.status === 'COMPLETED') || s.isCompleted) return false;
        if (s.id === incomingShift.id) return false;
        if (recentlyRelievedIds?.has?.(s.id)) return false;
        // Guardias retenidos: solo los cuyo turno terminó ≤45 min antes del turno entrante
        if (s.isRetention) {
            const scheduledEnd = toDate(s.endDateObj).getTime();
            return scheduledEnd >= start.getTime() - 45 * 60000;
        }
        const minutesUntilEnd = (toDate(s.endDateObj).getTime() - now.getTime()) / 60000;
        return minutesUntilEnd <= 15;
    });
    const handleConfirm = async (prevShiftId: string | null) => {
        try {
            const batch = writeBatch(db);
            batch.update(doc(db, 'turnos', incomingShift.id), { isPresent: true, status: 'PRESENT', realStartTime: serverTimestamp(), isLate: status === 'LATE' });
            if (prevShiftId) {
                batch.update(doc(db, 'turnos', prevShiftId), { realEndTime: serverTimestamp(), isCompleted: true, status: 'COMPLETED' });
            }
            await batch.commit();

            // Cerrar inmediatamente — write ya en IndexedDB local
            if (prevShiftId && onRelieved) onRelieved(prevShiftId);
            else onClose();
            toast.success(status === 'LATE' ? 'Ingreso Tarde registrado.' : 'Ingreso Correcto.');

            // Background: sync check (no bloquea UI)
            Promise.race([
                waitForPendingWrites(db),
                new Promise<void>((_, reject) => setTimeout(() => reject(new Error('sync_timeout')), 8000)),
            ]).catch(err => {
                if ((err as Error).message === 'sync_timeout') {
                    toast.warning('⚠️ Conexión lenta — verificá que el presente quedó guardado.');
                }
            }).catch(() => {});
        } catch (e: any) { toast.error('Error al procesar relevo: ' + (e?.message || e?.code || String(e))); }
    };
    return (
        <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
                <div className={`p-4 text-white flex justify-between items-start ${status === 'LATE' ? 'bg-amber-500' : 'bg-emerald-600'}`}>
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center font-black text-lg shrink-0">
                            {(incomingShift.employeeName || '?')[0].toUpperCase()}
                        </div>
                        <div>
                            <p className="font-black text-base leading-tight">{incomingShift.employeeName}</p>
                            <p className="text-xs font-semibold opacity-80 mt-0.5">
                                {status === 'LATE' ? `Llegada tarde · ${Math.round(diffMin)} min de retraso` : 'Ingreso a tiempo'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition-colors"><X size={18}/></button>
                </div>
                <div className="px-4 pt-3 pb-2 flex flex-wrap gap-1.5">
                    <span className="flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
                        <MapPin size={9}/> {incomingShift.objectiveName || '—'}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                        <Shield size={9}/> {incomingShift.positionName || '—'}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                        <Clock size={9}/> {formatTimeSimple(incomingShift.shiftDateObj)}–{formatTimeSimple(incomingShift.endDateObj)}
                    </span>
                </div>
                <div className="px-4 pb-5">
                    {activeGuards.length > 0 && (
                        <div className="space-y-2 mb-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Seleccione a quién relevar:</p>
                            {activeGuards.map((s:any) => (
                                <button key={s.id} onClick={() => handleConfirm(s.id)} className="w-full p-3 border rounded-xl hover:bg-slate-50 flex justify-between items-center group">
                                    <div className="text-left">
                                        <span className="block text-xs font-bold text-slate-700">{s.employeeName}</span>
                                        <span className="block text-[10px] text-slate-400">Salida: {formatTimeSimple(s.endDateObj)}</span>
                                    </div>
                                    <span className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded text-slate-600 group-hover:bg-slate-800 group-hover:text-white transition-colors">RELEVAR</span>
                                </button>
                            ))}
                        </div>
                    )}
                    {activeGuards.length === 0 && (
                        <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-center mb-3">
                            <p className="text-xs text-slate-400 italic">No hay guardia saliente registrado.</p>
                        </div>
                    )}
                    <button onClick={() => handleConfirm(null)}
                        className={`w-full py-3.5 font-black text-white rounded-xl transition-colors text-sm ${status === 'LATE' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                        {activeGuards.length > 0 ? 'INGRESAR SIN RELEVAR' : (status === 'LATE' ? 'CONFIRMAR LLEGADA TARDE' : 'CONFIRMAR INGRESO')}
                    </button>
                </div>
            </div>
        </div>
    );
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
    return (
        <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden">
                <div className={`p-4 text-white flex justify-between items-start ${isAlone ? 'bg-purple-600' : 'bg-emerald-600'}`}>
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center font-black text-lg shrink-0">
                            {(shift.employeeName || '?')[0].toUpperCase()}
                        </div>
                        <div>
                            <p className="font-black text-base leading-tight">{shift.employeeName}</p>
                            <p className="text-xs font-semibold opacity-80 mt-0.5">Baja Anticipada</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition-colors"><X size={18}/></button>
                </div>
                <div className="px-4 pt-3 pb-2 flex flex-wrap gap-1.5">
                    <span className="flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
                        <MapPin size={9}/> {shift.objectiveName || '—'}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                        <Shield size={9}/> {shift.positionName || '—'}
                    </span>
                </div>
                <div className="p-4">
                    <div className={`p-4 rounded-xl border mb-4 ${isAlone ? 'bg-purple-50 border-purple-100' : 'bg-emerald-50 border-emerald-100'}`}>
                        <h4 className={`font-bold text-sm mb-1 ${isAlone ? 'text-purple-800' : 'text-emerald-800'}`}>
                            {isAlone ? '⚠️ GUARDIA SOLO EN EL OBJETIVO' : `✅ HAY ${colleagues.length} COMPAÑEROS`}
                        </h4>
                        <p className="text-xs text-slate-500">
                            {isAlone ? 'El puesto quedará descubierto. Se requiere activar protocolo.' : 'El puesto puede ser cubierto por la dotación actual.'}
                        </p>
                    </div>
                    {isAlone ? (
                        <button onClick={handleProtocol} className="w-full py-3.5 bg-purple-600 text-white font-black rounded-xl hover:bg-purple-700 transition-colors animate-pulse shadow-lg shadow-purple-200">
                            INICIAR PROTOCOLO DE COBERTURA
                        </button>
                    ) : (
                        <button onClick={handleLog} className="w-full py-3.5 bg-emerald-600 text-white font-black rounded-xl hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200">
                            REGISTRAR NOVEDAD (CUBIERTO)
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
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

const CoverageRow = ({ item, lKey, onAction, label, color, loading, onWA, objectiveId }: any) => {
    const name = item.employeeName || item.fullName || '';
    const ph = item.phone || item.celular || '';
    const busy = loading === lKey;
    const category = item.category || item.categoria || '';
    // ¿Tiene experiencia registrada en este objetivo específico?
    const expCount = objectiveId && item.experienciaObjetivos?.[objectiveId]?.count;
    return (
        <div className="flex items-center justify-between p-2.5 bg-white border border-slate-100 rounded-lg gap-2 shadow-sm">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-slate-800 leading-tight">{name}</span>
                    {expCount > 0 && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0" title={`${expCount} turno(s) previos aquí`}>
                            ✓ {expCount}T exp.
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    {category && (
                        <span className="text-[9px] font-medium text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">{category}</span>
                    )}
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
    const [showNoCoverage, setShowNoCoverage] = useState(false);
    const [noCoverageNotes, setNoCoverageNotes] = useState('');
    const [noCoverageLoading, setNoCoverageLoading] = useState(false);
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
        toDate(s.shiftDateObj) > now &&
        isSameDay(s.shiftDateObj, now)   // ← solo turno de HOY, no del día siguiente
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
            // endTime = fin real del turno a cubrir (NO 8h fijos — respetar SLA)
            const endTime = absenceEnd;
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
                    <div className="p-4 bg-rose-600 text-white flex justify-between items-start shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center font-black text-lg shrink-0">
                                {(absenceShift.employeeName || 'V')[0].toUpperCase()}
                            </div>
                            <div>
                                <p className="text-[10px] font-bold opacity-70 uppercase">Protocolo de Cobertura</p>
                                <p className="font-black text-base leading-tight">{absenceShift.employeeName || 'Vacante'}</p>
                                <p className="text-xs font-semibold opacity-80 mt-0.5">{absenceShift.objectiveName} · {hiStart}–{hiEnd}</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="bg-white/20 p-1.5 rounded-lg hover:bg-white/30 transition-colors shrink-0"><X size={18}/></button>
                    </div>
                    <div className="px-4 py-2 flex flex-wrap gap-1.5 bg-rose-50 border-b border-rose-100 shrink-0">
                        <span className="flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-white border border-rose-200 px-2.5 py-1 rounded-full"><Shield size={9}/> {absenceShift.positionName || '—'}</span>
                        <span className="flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-full"><Clock size={9}/> {hiStart}–{hiEnd}</span>
                    </div>
                    <div className="p-4 overflow-y-auto custom-scrollbar space-y-5 flex-1">
                        <CoverageSection num="1" title="Retención · Guardia presente en el objetivo" colorClass="text-orange-700" badgeClass="bg-orange-500"
                            empty="No hay guardias presentes en este objetivo."
                            items={retencion.map((s: any) => <CoverageRow key={s.id} item={s} lKey={'ret_'+s.id} onAction={()=>handleRetener(s)} label="RETENER" color="bg-orange-500 hover:bg-orange-600" loading={loading} onWA={openLocalWA} objectiveId={absenceShift.objectiveId}/>)}
                        />
                        <CoverageSection num="2" title="Adelanto · Próximo turno planificado (hoy)" colorClass="text-indigo-700" badgeClass="bg-indigo-500"
                            empty="No hay turno próximo planificado para hoy."
                            items={adelanto.map((s: any) => <CoverageRow key={s.id} item={s} lKey={'adel_'+s.id} onAction={()=>handleAdelantar(s)} label="ADELANTAR" color="bg-indigo-600 hover:bg-indigo-700" loading={loading} onWA={openLocalWA} objectiveId={absenceShift.objectiveId}/>)}
                        />
                        <CoverageSection num="3" title="Retenes · Sin turno hoy" colorClass="text-slate-700" badgeClass="bg-slate-600"
                            empty="No hay retenes disponibles."
                            items={retenes.map((e: any) => <CoverageRow key={e.id} item={e} lKey={'reten_'+e.id} onAction={()=>handleReten(e)} label="CONVOCAR" color="bg-slate-700 hover:bg-slate-800" loading={loading} onWA={openLocalWA} objectiveId={absenceShift.objectiveId}/>)}
                        />
                        <CoverageSection num="4" title="Francos · Día libre" colorClass="text-blue-700" badgeClass="bg-blue-500"
                            empty="No hay francos disponibles hoy."
                            items={francos.map((s: any) => <CoverageRow key={s.id} item={s} lKey={'franco_'+s.id} onAction={()=>handleFranco(s)} label="CONVOCAR FT" color="bg-blue-600 hover:bg-blue-700" loading={loading} onWA={openLocalWA} objectiveId={absenceShift.objectiveId}/>)}
                        />
                        <div className="border-t border-slate-200 pt-4 mt-2">
                            {!showNoCoverage ? (
                                <button onClick={() => setShowNoCoverage(true)} className="w-full py-2.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-xl text-xs font-bold hover:bg-slate-200 transition-colors flex items-center justify-center gap-1.5">
                                    <XCircle size={13}/>Sin cobertura — dejar sin cubrir
                                </button>
                            ) : (
                                <div className="bg-slate-50 border border-slate-300 rounded-xl p-3">
                                    <p className="text-xs font-bold text-slate-700 mb-2">Registrar puesto sin cobertura</p>
                                    <textarea value={noCoverageNotes} onChange={e => setNoCoverageNotes(e.target.value)} placeholder="Motivo (opcional)..." rows={2} className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white resize-none focus:outline-none focus:ring-1 focus:ring-slate-400 mb-2"/>
                                    <div className="flex gap-2">
                                        <button onClick={async () => {
                                            setNoCoverageLoading(true);
                                            try {
                                                await addDoc(collection(db, 'novedades'), stampEmpresaId({
                                                    type: 'SIN_COBERTURA', title: 'Puesto sin cobertura', status: 'pending',
                                                    objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName || '',
                                                    positionName: absenceShift.positionName || '',
                                                    employeeId: absenceShift.employeeId || null, employeeName: absenceShift.employeeName || null,
                                                    clientId: absenceShift.clientId || null, shiftId: absenceShift.id || null,
                                                    description: noCoverageNotes || `Protocolo agotado — ${absenceShift.positionName} en ${absenceShift.objectiveName} queda sin cobertura.`,
                                                    createdAt: serverTimestamp(), reportedBy: 'OPERACIONES',
                                                }, tenantId(absenceShift)));
                                                // Crear doc sintético en turnos para que el hook no regenere la vacante
                                                if (absenceShift.objectiveId && absenceShift.positionName) {
                                                    const startTs = absenceShift.shiftDateObj instanceof Date ? absenceShift.shiftDateObj : new Date(absenceShift.shiftDateObj);
                                                    const endTs   = absenceShift.endDateObj   instanceof Date ? absenceShift.endDateObj   : new Date(absenceShift.endDateObj);
                                                    try {
                                                        await addDoc(collection(db, 'turnos'), stampEmpresaId({
                                                            origin: 'SIN_COBERTURA', status: 'SIN_COBERTURA',
                                                            employeeId: 'VACANTE', employeeName: 'SIN COBERTURA',
                                                            isReported: true, resolvedBy: 'OPERACIONES',
                                                            objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName || '',
                                                            positionName: absenceShift.positionName, clientId: absenceShift.clientId || null,
                                                            startTime: Timestamp.fromDate(startTs), endTime: Timestamp.fromDate(endTs),
                                                            createdAt: serverTimestamp(),
                                                        }, tenantId(absenceShift)));
                                                    } catch(e) { /* non-critical */ }
                                                }
                                                toast.info(`Puesto ${absenceShift.positionName} registrado sin cobertura.`);
                                                onClose();
                                            } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
                                            finally { setNoCoverageLoading(false); }
                                        }} disabled={noCoverageLoading} className="flex-1 py-2 bg-slate-700 text-white rounded-lg text-xs font-bold hover:bg-slate-800 disabled:opacity-60 transition-colors">
                                            {noCoverageLoading ? 'Guardando...' : 'CONFIRMAR SIN COBERTURA'}
                                        </button>
                                        <button onClick={() => setShowNoCoverage(false)} className="px-3 py-2 bg-white border border-slate-200 text-slate-500 rounded-lg text-xs font-bold hover:bg-slate-50 transition-colors">Cancelar</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <WAComposeModal isOpen={localWa.isOpen} onClose={() => setLocalWa((d: any) => ({...d, isOpen: false}))} ctx={localWa.ctx}/>
        </>
    );
};

const AbsenceDecisionModal = ({ isOpen, onClose, shift, onDeclareAbsent, onLateArrival, onOpenWA }: any) => {
    const [view, setView] = React.useState<'decision' | 'late'>('decision');
    const [etaTime, setEtaTime] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    useEffect(() => { if (isOpen) { setView('decision'); setEtaTime(''); setLoading(false); } }, [isOpen]);
    if (!isOpen || !shift) return null;
    const initials = (shift.employeeName || '?').split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0]).join('').toUpperCase();
    const minutesLate = Math.round(shift.minutesPastStart ?? 0);
    const hiStart = shift.shiftDateObj ? new Date(shift.shiftDateObj).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false}) : '';
    const hiEnd   = shift.endDateObj   ? new Date(shift.endDateObj).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false}) : '';
    const preMsg  = waMensaje.tardanza(shift.employeeName || '', shift.objectiveName || '', hiStart);
    return (
        <div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="bg-orange-500 p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                        <span className="text-white font-black text-sm">{initials}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-white font-bold text-base leading-tight truncate">{shift.employeeName}</p>
                        <p className="text-orange-100 text-xs flex items-center gap-1 mt-0.5"><Clock size={11}/>{minutesLate} min sin check-in</p>
                    </div>
                    <button onClick={onClose} className="bg-white/20 p-1.5 rounded-lg hover:bg-white/30 shrink-0"><X size={16} className="text-white"/></button>
                </div>
                {/* Chips */}
                <div className="px-4 py-2 flex flex-wrap gap-1.5 bg-orange-50 border-b border-orange-100">
                    {shift.objectiveName && <span className="flex items-center gap-1 text-[10px] font-bold text-orange-700 bg-white border border-orange-200 px-2.5 py-1 rounded-full"><MapPin size={9}/>{shift.objectiveName}</span>}
                    {shift.positionName  && <span className="flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-full"><Shield size={9}/>{shift.positionName}</span>}
                    {hiStart && hiEnd     && <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded-full"><Clock size={9}/>{hiStart}–{hiEnd}</span>}
                </div>

                {view === 'decision' ? (
                    <div className="p-4 space-y-3">
                        {/* Contactar */}
                        <div className="border border-slate-200 rounded-xl p-3 bg-slate-50">
                            <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Contactar</p>
                            <div className="flex gap-2">
                                <button onClick={() => onOpenWA && onOpenWA(shift, 'tardanza')} className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors"><MessageCircle size={14}/>WhatsApp</button>
                                <button onClick={() => shift.phone && window.open(`tel:${shift.phone}`)} className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg transition-colors"><Phone size={14}/>Llamar</button>
                            </div>
                        </div>
                        {/* Mensaje preconfigurado */}
                        <div className="border border-emerald-200 rounded-xl p-3 bg-emerald-50">
                            <p className="text-[10px] font-black text-emerald-700 uppercase mb-1.5">Mensaje sugerido</p>
                            <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">{preMsg}</p>
                        </div>
                        {/* Decisión */}
                        <div>
                            <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Decisión</p>
                            <div className="space-y-2">
                                <button onClick={() => setView('late')} className="w-full flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl hover:border-orange-300 hover:bg-orange-50 transition-colors text-left">
                                    <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center shrink-0"><Clock size={15} className="text-orange-600"/></div>
                                    <div><p className="text-sm font-bold text-slate-800">Llegada tarde</p><p className="text-[10px] text-slate-500">Registrar hora estimada de llegada</p></div>
                                </button>
                                <button onClick={async () => { setLoading(true); await onDeclareAbsent?.(shift); setLoading(false); onClose(); }} disabled={loading} className="w-full flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl hover:border-red-300 hover:bg-red-50 transition-colors text-left">
                                    <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0"><XCircle size={15} className="text-red-600"/></div>
                                    <div><p className="text-sm font-bold text-slate-800">Declarar ausente</p><p className="text-[10px] text-slate-500">Inicia protocolo de cobertura</p></div>
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="p-4 space-y-3">
                        <button onClick={() => setView('decision')} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"><CornerUpLeft size={13}/>Volver</button>
                        <div className="border border-slate-200 rounded-xl p-3 bg-slate-50">
                            <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Hora estimada de llegada</p>
                            <input type="time" value={etaTime} onChange={e => setEtaTime(e.target.value)} className="w-full text-sm border border-slate-300 rounded-lg p-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"/>
                        </div>
                        <button onClick={async () => { if (!etaTime) return; setLoading(true); await onLateArrival?.(shift, etaTime); setLoading(false); onClose(); }} disabled={loading || !etaTime} className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors">
                            {loading ? 'Registrando...' : 'Confirmar llegada tarde'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const RRHHVacancyModal = ({ isOpen, onClose, shift, onCoverageProtocol, onSendToPlanning }: any) => {
    if (!isOpen || !shift) return null;
    const initials = (shift.employeeName || '?').split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0]).join('').toUpperCase();
    const hiStart = shift.shiftDateObj ? new Date(shift.shiftDateObj).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false}) : '';
    const hiEnd   = shift.endDateObj   ? new Date(shift.endDateObj).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false}) : '';
    const isVirtual = shift.isVirtual;
    return (
        <div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className={`p-4 flex items-center gap-3 ${isVirtual ? 'bg-rose-600' : 'bg-blue-600'}`}>
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                        {isVirtual ? <AlertTriangle size={18} className="text-white"/> : <span className="text-white font-black text-sm">{initials}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-white/70 text-[10px] font-bold uppercase">Vacante · {isVirtual ? 'Sin planificación' : 'Novedad RRHH'}</p>
                        <p className="text-white font-bold text-base leading-tight truncate">{shift.employeeName || `VACANTE: ${shift.positionName}`}</p>
                        <p className="text-white/80 text-xs mt-0.5">{shift.objectiveName} · {hiStart}–{hiEnd}</p>
                    </div>
                    <button onClick={onClose} className="bg-white/20 p-1.5 rounded-lg hover:bg-white/30 shrink-0"><X size={16} className="text-white"/></button>
                </div>
                {/* Chips */}
                <div className={`px-4 py-2 flex flex-wrap gap-1.5 border-b ${isVirtual ? 'bg-rose-50 border-rose-100' : 'bg-blue-50 border-blue-100'}`}>
                    {shift.positionName  && <span className={`flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border bg-white ${isVirtual ? 'text-rose-700 border-rose-200' : 'text-blue-700 border-blue-200'}`}><Shield size={9}/>{shift.positionName}</span>}
                    {hiStart && hiEnd     && <span className="flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-full"><Clock size={9}/>{hiStart}–{hiEnd}</span>}
                </div>

                <div className="p-4 space-y-3">
                    {/* Info card */}
                    {!isVirtual ? (
                        <div className="border border-amber-200 rounded-xl p-3 bg-amber-50">
                            <p className="text-[10px] font-black text-amber-700 uppercase mb-1">Motivo registrado en RRHH</p>
                            <p className="text-xs text-amber-800 font-medium">{shift.novedadRRHH || 'Novedad registrada — ver detalle en RRHH'}</p>
                        </div>
                    ) : (
                        <div className="border border-slate-200 rounded-xl p-3 bg-slate-50">
                            <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Planning no disponible</p>
                            <p className="text-xs text-slate-600">No hay turno planificado para este puesto en este horario.</p>
                        </div>
                    )}
                    {/* CTA */}
                    <button onClick={() => { onCoverageProtocol?.(shift); onClose(); }} className="w-full flex items-center justify-center gap-2 py-3 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm">
                        <Radio size={15}/>Activar protocolo de cobertura
                    </button>
                    {!isVirtual && (
                        <button onClick={() => { onSendToPlanning?.(shift); onClose(); }} className="w-full flex items-center justify-center gap-2 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-xl transition-colors">
                            <CornerUpLeft size={14}/>Enviar a planificación
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

const WorkedDayOffModal = (props: any) => <WorkedDayOffModalPro {...props} />;
const RetentionModal = ({ isOpen, onClose, retainedShift }: any) => {
    if (!isOpen || !retainedShift) return null;
    const initials = (retainedShift.employeeName || '?').split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0]).join('').toUpperCase();
    return (
        <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
                <div className="p-4 bg-orange-600 flex justify-between items-start">
                    <div>
                        <p className="text-orange-200 text-[10px] font-bold uppercase tracking-widest mb-0.5">Guardia retenido</p>
                        <p className="text-white font-bold text-base leading-tight">{retainedShift.objectiveName || '—'}</p>
                        <div className="flex gap-1.5 mt-1.5 flex-wrap">
                            {retainedShift.positionName && <span className="bg-orange-700/60 text-orange-100 text-[10px] px-2 py-0.5 rounded">{retainedShift.positionName}</span>}
                        </div>
                    </div>
                    <button onClick={onClose} className="bg-white/20 p-1.5 rounded-lg hover:bg-white/30 shrink-0"><X size={16} className="text-white"/></button>
                </div>
                <div className="p-5">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                            <span className="text-orange-700 font-bold text-base">{initials}</span>
                        </div>
                        <div>
                            <p className="font-bold text-slate-900 text-sm">{retainedShift.employeeName}</p>
                            <p className="text-xs text-orange-600 font-semibold mt-0.5">En retención — turno extendido</p>
                        </div>
                    </div>
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4 text-xs text-orange-800">
                        El guardia permanece en el puesto más allá de su horario planificado hasta que llegue el relevo.
                    </div>
                    <button onClick={onClose} className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-colors text-sm">Entendido</button>
                </div>
            </div>
        </div>
    );
};
const CheckOutModal = ({ isOpen, onClose, onConfirm, employeeName, shift }: any) => {
    const [novedad, setNovedad] = React.useState('');
    const [showNovedad, setShowNovedad] = React.useState(false);
    if (!isOpen) return null;
    const initials = (employeeName || '?').split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0]).join('').toUpperCase();
    return (
        <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
                <div className="p-4 bg-purple-700 flex justify-between items-start">
                    <div>
                        <p className="text-purple-200 text-[10px] font-bold uppercase tracking-widest mb-0.5">Salida del guardia</p>
                        <p className="text-white font-bold text-base leading-tight">{shift?.objectiveName || 'Turno'}</p>
                        {shift && (<div className="flex gap-1.5 mt-1.5 flex-wrap">
                            {shift.positionName && <span className="bg-purple-900/50 text-purple-100 text-[10px] px-2 py-0.5 rounded">{shift.positionName}</span>}
                            <span className="bg-purple-900/50 text-purple-100 text-[10px] px-2 py-0.5 rounded font-mono">{shift.shiftCode || ''}</span>
                        </div>)}
                    </div>
                    <button onClick={onClose} className="bg-white/20 p-1.5 rounded-lg hover:bg-white/30 shrink-0"><X size={16} className="text-white"/></button>
                </div>
                <div className="p-5">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                            <span className="text-purple-700 font-bold text-base">{initials}</span>
                        </div>
                        <div><p className="font-bold text-slate-900 text-sm">{employeeName}</p><p className="text-xs text-slate-500 mt-0.5">Registrar salida del turno</p></div>
                    </div>
                    <button onClick={() => { onConfirm(false); onClose(); }} className="w-full py-3 bg-purple-700 text-white font-bold rounded-xl hover:bg-purple-800 transition-colors text-sm mb-3">CONFIRMAR SALIDA</button>
                    <button onClick={() => setShowNovedad(v => !v)} className="w-full py-2 text-xs text-slate-500 hover:text-slate-700 border border-dashed border-slate-200 rounded-xl transition-colors mb-2">
                        {showNovedad ? '▲ Ocultar novedad' : '+ Reportar novedad al salir'}
                    </button>
                    {showNovedad && (<>
                        <textarea className="w-full p-3 border border-slate-200 rounded-xl text-sm mb-2 resize-none focus:outline-none focus:border-purple-400" rows={3} placeholder="Describí la novedad..." value={novedad} onChange={e=>setNovedad(e.target.value)}/>
                        <button onClick={() => { onConfirm(novedad); setNovedad(''); onClose(); }} disabled={!novedad.trim()} className="w-full py-2.5 bg-slate-700 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors text-sm disabled:opacity-40 mb-2">REPORTAR Y SALIR</button>
                    </>)}
                    <button onClick={onClose} className="w-full py-2 text-xs text-slate-400 hover:text-slate-600 transition-colors">Cancelar</button>
                </div>
            </div>
        </div>
    );
};
const AttendanceModal = ({ isOpen, onClose, shift, onMarkAbsent }: any) => { if (!isOpen) return null; return (<div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6 text-center"><AlertTriangle size={48} className="mx-auto text-amber-500 mb-4"/><h3 className="font-bold text-lg mb-2">Confirmar Ausencia</h3><p className="text-sm text-slate-500 mb-6">¿{shift?.employeeName} no se presentó?</p><button onClick={() => onMarkAbsent(shift)} className="w-full py-3 bg-rose-600 text-white rounded-xl font-bold mb-2">MARCAR AUSENTE</button><button onClick={onClose} className="text-sm text-slate-400">Cancelar</button></div></div>); };

// ── NOVEDAD DETAIL POPUP ─────────────────────────────────────────────────────
const TYPE_META_MAP: Record<string, { label: string; bg: string; text: string; border: string }> = {
    AUSENCIA_AUTO:                { label: 'AUSENCIA AUTO',  bg: 'bg-rose-600',   text: 'text-white', border: 'border-rose-500' },
    AUSENCIA_CORTO_PLAZO:         { label: 'URGENTE',        bg: 'bg-red-600',    text: 'text-white', border: 'border-red-500' },
    AVISO_AUSENCIA_ANTICIPADA:    { label: 'ANTICIPADA',     bg: 'bg-amber-500',  text: 'text-white', border: 'border-amber-400' },
    VACANTE_PROTOCOLO_COBERTURA:  { label: 'PROTOCOLO',      bg: 'bg-orange-500', text: 'text-white', border: 'border-orange-400' },
    RELEVO_NO_PRESENTADO:         { label: 'SIN RELEVO',     bg: 'bg-amber-600',  text: 'text-white', border: 'border-amber-500' },
    POSICION_SIN_RELEVO:          { label: 'SIN RELEVO',     bg: 'bg-amber-600',  text: 'text-white', border: 'border-amber-500' },
    RETENCION_LARGA:              { label: 'RETENCIÓN',      bg: 'bg-orange-700', text: 'text-white', border: 'border-orange-600' },
    RELEVO_INMINENTE:             { label: 'RELEVO',         bg: 'bg-blue-600',   text: 'text-white', border: 'border-blue-500' },
    CONVOCATORIA_RETEN:           { label: 'CONVOCATORIA',   bg: 'bg-indigo-600', text: 'text-white', border: 'border-indigo-500' },
    FRANCO_TRABAJADO:             { label: 'FRANCO TRAB.',   bg: 'bg-indigo-600', text: 'text-white', border: 'border-indigo-500' },
    ADELANTO_TURNO:               { label: 'ADELANTO',       bg: 'bg-indigo-500', text: 'text-white', border: 'border-indigo-400' },
    RRHH_NOVEDAD:                 { label: 'RRHH',           bg: 'bg-purple-600', text: 'text-white', border: 'border-purple-500' },
    REFUERZO_CLIENTE_PENDIENTE:   { label: 'REFUERZO CLIENTE', bg: 'bg-violet-600', text: 'text-white', border: 'border-violet-500' },
    VACANTE_OPERATIVA:            { label: 'VACANTE RFZ/TURA', bg: 'bg-fuchsia-600', text: 'text-white', border: 'border-fuchsia-500' },
    TURA_EXTENSION:               { label: 'TURA EXT', bg: 'bg-violet-600', text: 'text-white', border: 'border-violet-500' },
};
const DEFAULT_META_MAP = { label: 'NOVEDAD', bg: 'bg-slate-700', text: 'text-white', border: 'border-slate-500' };
const AUTO_CLOSE_MAP = 3000;

const NovedadDetailPopupMap = ({ novedad, onClose, onAtender }: { novedad: any; onClose: () => void; onAtender: (n: any) => void }) => {
    const [remaining, setRemaining] = React.useState(AUTO_CLOSE_MAP);
    const intervalRef = React.useRef<any>(null);
    const meta = TYPE_META_MAP[novedad?.type] ?? DEFAULT_META_MAP;

    React.useEffect(() => {
        if (!novedad) return;
        setRemaining(AUTO_CLOSE_MAP);
        const tick = 50;
        intervalRef.current = setInterval(() => {
            setRemaining(r => {
                if (r <= tick) { clearInterval(intervalRef.current); onClose(); return 0; }
                return r - tick;
            });
        }, tick);
        return () => clearInterval(intervalRef.current);
    }, [novedad?.id]);

    if (!novedad) return null;

    const ts = novedad.createdAt?.seconds ? new Date(novedad.createdAt.seconds * 1000) : null;
    const pct = (remaining / AUTO_CLOSE_MAP) * 100;
    const pause = () => clearInterval(intervalRef.current);
    const resume = () => {
        clearInterval(intervalRef.current);
        const tick = 50;
        intervalRef.current = setInterval(() => {
            setRemaining(r => {
                if (r <= tick) { clearInterval(intervalRef.current); onClose(); return 0; }
                return r - tick;
            });
        }, tick);
    };

    return (
        <div className="fixed inset-0 z-[9500] flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.60)', backdropFilter: 'blur(4px)' }}
             onClick={onClose}>
            <div
                className={`w-full max-w-sm rounded-2xl shadow-2xl border-2 ${meta.border} overflow-hidden`}
                style={{ background: '#0f172a' }}
                onClick={e => e.stopPropagation()}
                onMouseEnter={pause}
                onMouseLeave={resume}
            >
                {/* Barra auto-cierre */}
                <div className="h-1 w-full bg-white/10">
                    <div className={`h-full ${meta.bg} transition-none`}
                         style={{ width: `${pct}%`, transition: 'width 50ms linear' }} />
                </div>
                {/* Header */}
                <div className={`${meta.bg} px-4 py-3 flex items-center justify-between`}>
                    <span className={`text-xs font-black uppercase tracking-widest ${meta.text}`}>
                        {novedad.title ? String(novedad.title).slice(0, 48) : meta.label}
                    </span>
                    <div className="flex items-center gap-2">
                        {ts && (
                            <span className="text-[10px] font-mono text-white/70">
                                {ts.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' })}
                            </span>
                        )}
                        <button onClick={onClose} className="text-white/60 hover:text-white transition-colors"><X size={14}/></button>
                    </div>
                </div>
                {/* Cuerpo */}
                <div className="px-5 py-4 space-y-3">
                    {novedad.employeeName && (
                        <div className="flex items-center gap-2">
                            <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-sm font-black text-white shrink-0">
                                {novedad.employeeName[0]?.toUpperCase()}
                            </div>
                            <div>
                                <p className="text-white font-black text-sm leading-tight">{novedad.employeeName}</p>
                                {novedad.positionName && <p className="text-white/50 text-[10px]">{novedad.positionName}</p>}
                            </div>
                        </div>
                    )}
                    {novedad.objectiveName && (
                        <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                            <MapPin size={13} className="text-white/40 shrink-0"/>
                            <span className="text-white/90 text-xs font-bold">{novedad.objectiveName}</span>
                        </div>
                    )}
                    {novedad.clientName && novedad.clientName !== novedad.objectiveName && (
                        <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-1.5">
                            <span className="text-white/40 text-[10px] shrink-0">Cliente</span>
                            <span className="text-white/70 text-xs">{novedad.clientName}</span>
                        </div>
                    )}
                    {(novedad.type === 'REFUERZO_CLIENTE_PENDIENTE' || novedad.type === 'VACANTE_OPERATIVA' || novedad.type === 'TURA_EXTENSION') && (
                        <div className="space-y-1.5 text-xs text-white/80">
                            {novedad.tipoSolicitud && (
                                <p><span className="text-white/50">Tipo:</span> <span className="font-bold text-white">{novedad.tipoSolicitud}</span></p>
                            )}
                            {(novedad.fecha || novedad.startTime) && (
                                <p><span className="text-white/50">Cuándo:</span> {novedad.fecha || '—'} · {novedad.startTime || ''}{novedad.endTime ? `–${novedad.endTime}` : ''}</p>
                            )}
                            {novedad.cantidadPax != null && novedad.tipoSolicitud === 'RFZ' && (
                                <p><span className="text-white/50">Personas:</span> {novedad.cantidadPax}</p>
                            )}
                            {novedad.horasVendidasEstimadas != null && (
                                <p><span className="text-white/50">Hs. vendidas (pactadas):</span> {novedad.horasVendidasEstimadas}h</p>
                            )}
                            {novedad.parentEmpleadoName && (
                                <p><span className="text-white/50">Guardia base:</span> {novedad.parentEmpleadoName}</p>
                            )}
                            {novedad.motivo && (
                                <p className="text-white/60 italic">{novedad.motivo}</p>
                            )}
                        </div>
                    )}
                    {novedad.description && (
                        <p className="text-white/70 text-xs leading-relaxed border-l-2 border-white/20 pl-3">
                            {novedad.description}
                        </p>
                    )}
                    {novedad.minutesBeforeShift != null && novedad.minutesBeforeShift > 0 && (
                        <div className="flex items-center gap-1.5 text-amber-400">
                            <Clock size={12}/>
                            <span className="text-xs font-bold">{novedad.minutesBeforeShift} min al inicio del turno</span>
                        </div>
                    )}
                </div>
                {/* Footer */}
                <div className="px-4 pb-4 flex items-center justify-between gap-3">
                    <span className="text-white/30 text-[10px]">
                        Cerrando en {Math.ceil(remaining / 1000)}s · hover pausa
                    </span>
                    <button
                        onClick={() => { onAtender(novedad); onClose(); }}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-white transition-all hover:scale-105 ${meta.bg}`}
                    >
                        <CheckCircle size={13}/>
                        ATENDER
                    </button>
                </div>
            </div>
        </div>
    );
};
// ─────────────────────────────────────────────────────────────────────────────

const ManualRetentionModal = ({ isOpen, onClose, shift }: any) => {
    const [selected, setSelected] = React.useState<'1' | '2' | '4' | 'open' | null>(null);
    const [loading, setLoading] = React.useState(false);
    if (!isOpen || !shift) return null;
    const now = new Date();
    const endTime: Date = shift.endDateObj instanceof Date ? shift.endDateObj : now;
    const checkInTime: Date | null = shift.activeStartTime instanceof Date ? shift.activeStartTime : null;
    const max12h: Date | null = checkInTime ? new Date(checkInTime.getTime() + 12 * 3600000) : null;
    const getNewEnd = (h: number) => { const base = endTime > now ? endTime : now; return new Date(base.getTime() + h * 3600000); };
    const fmt = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const handleConfirm = async () => {
        if (!selected) return;
        setLoading(true);
        try {
            const updates: any = {};
            if (selected !== 'open') {
                const newEnd = getNewEnd(parseInt(selected));
                updates.endTime = Timestamp.fromDate(newEnd);
                updates.manualRetentionType = 'extended';
                updates.manualRetentionHours = parseInt(selected);
                updates.retentionType = null;
                updates.retentionUntil = null;
                updates.isRetention = false;
                updates.retentionReason = null;
            } else {
                updates.manualRetentionType = 'open';
                updates.retentionType = 'open';
                if (max12h) updates.retentionUntil = Timestamp.fromDate(max12h);
            }
            await updateDoc(doc(db, 'turnos', shift.id), updates);
            if (selected !== 'open') {
                const nSnap = await getDocs(query(
                    collection(db, 'novedades'),
                    where('shiftId', '==', shift.id),
                    where('type', '==', 'RETENCION_DETECTADA'),
                    where('status', '==', 'pending')
                ));
                await Promise.all(nSnap.docs.map(d => updateDoc(d.ref, { status: 'ATENDIDA', resolvedAt: serverTimestamp(), resolvedBy: 'RETENCIÓN_MANUAL' })));
            }
            onClose();
        } catch (e: any) { toast.error('Error al aplicar retención: ' + (e as any).message); }
        setLoading(false);
    };
    const options = [
        { key: '1', label: '+1h', sub: fmt(getNewEnd(1)) },
        { key: '2', label: '+2h', sub: fmt(getNewEnd(2)) },
        { key: '4', label: '+4h', sub: fmt(getNewEnd(4)) },
        { key: 'open', label: 'Indeterminada', sub: max12h ? `máx. ${fmt(max12h)}` : 'hasta 12h' },
    ] as const;
    const newEnd = selected && selected !== 'open' ? getNewEnd(parseInt(selected)) : null;
    return (
        <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
                <div className="p-4 bg-orange-600 flex justify-between items-start">
                    <div>
                        <p className="text-orange-200 text-[10px] font-bold uppercase tracking-widest mb-0.5">Retención manual</p>
                        <p className="text-white font-bold text-base leading-tight">{shift.objectiveName || '—'}</p>
                        <div className="flex gap-1.5 mt-1.5">
                            <span className="bg-orange-700/60 text-orange-100 text-[10px] px-2 py-0.5 rounded font-mono">{formatTimeRange(shift.shiftDateObj, shift.endDateObj)}</span>
                            {shift.positionName && <span className="bg-orange-700/60 text-orange-100 text-[10px] px-2 py-0.5 rounded">{shift.positionName}</span>}
                        </div>
                    </div>
                    <button onClick={onClose} className="bg-white/20 p-1.5 rounded-lg hover:bg-white/30 shrink-0"><X size={16} className="text-white"/></button>
                </div>
                <div className="p-5">
                    <p className="text-[11px] font-bold text-slate-500 mb-1 uppercase">Empleado</p>
                    <p className="font-black text-slate-800 text-sm mb-4">{shift.employeeName || '—'}</p>
                    <p className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-wide">Tiempo extra</p>
                    <div className="grid grid-cols-2 gap-2 mb-4">
                        {options.map(o => (
                            <button key={o.key} onClick={() => setSelected(o.key as any)}
                                className={`py-3 px-2 rounded-xl border-2 text-sm font-black transition-all text-center ${selected === o.key ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 hover:border-orange-300 text-slate-700 hover:bg-orange-50/40'}`}>
                                {o.label}
                                <span className="block text-[10px] font-semibold text-slate-400 mt-0.5">{o.sub}</span>
                            </button>
                        ))}
                    </div>
                    {selected && selected !== 'open' && newEnd && (
                        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4 text-xs text-orange-800 flex items-center gap-2">
                            <Clock size={13} className="shrink-0 text-orange-500"/>
                            <span>Corte automático a las <strong>{fmt(newEnd)}</strong></span>
                        </div>
                    )}
                    {selected === 'open' && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-xs text-amber-800 flex items-center gap-2">
                            <AlarmClock size={13} className="shrink-0 text-amber-500"/>
                            <span>Retención activa. Corte manual o automático a las <strong>{max12h ? fmt(max12h) : '12h desde entrada'}</strong></span>
                        </div>
                    )}
                    <div className="flex gap-2">
                        <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-black text-sm hover:bg-slate-50 transition-colors">Cancelar</button>
                        <button onClick={handleConfirm} disabled={!selected || loading}
                            className="flex-1 py-3 rounded-xl bg-orange-600 hover:bg-orange-700 disabled:opacity-40 text-white font-black text-sm transition-colors flex items-center justify-center gap-2">
                            {loading ? <Loader2 size={14} className="animate-spin"/> : <Timer size={14}/>} Confirmar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function TacticalMapView() {
    const router = useRouter();
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = !!(empresa as any)?.migracionCompleta;
    const logic = useOperacionesMonitor();
    const [empNovedades, setEmpNovedades] = useState<any[]>([]);
    const [notifPanelOpen, setNotifPanelOpen] = useState(false);
    // Refresh key: reconecta listener al volver de background, recuperar red, o cada 3 min
    const [refreshKey, setRefreshKey] = useState(0);
    useEffect(() => {
        const bump = () => setRefreshKey(k => k + 1);
        const onVisible = () => { if (document.visibilityState === 'visible') bump(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', bump);
        const periodicRefresh = setInterval(bump, 3 * 60 * 1000);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', bump);
            clearInterval(periodicRefresh);
        };
    }, []);

    // BroadcastChannel: anunciar presencia a CC y escuchar solicitud de cierre
    useEffect(() => {
        if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
        const ch = new BroadcastChannel('crono_mapview_sync');
        // Anunciar que map-view está abierto
        ch.postMessage({ type: 'MAPVIEW_OPEN' });
        // Heartbeat cada 5s para que CC detecte la ventana incluso si abrió antes
        const hb = setInterval(() => ch.postMessage({ type: 'MAPVIEW_HEARTBEAT' }), 5000);
        // Escuchar solicitud de cierre desde CC
        ch.onmessage = (e) => {
            if (e.data?.type === 'MAPVIEW_CLOSE_REQUEST') {
                ch.postMessage({ type: 'MAPVIEW_CLOSED' });
                window.close();
            }
        };
        return () => {
            ch.postMessage({ type: 'MAPVIEW_CLOSED' });
            clearInterval(hb);
            ch.close();
        };
    }, []);
    const pendingNovedades = useMemo(() =>
        empNovedades.filter(n => {
            if (n.status === 'ATENDIDA' || n.status === 'atendida') return false;
            if (n.type === 'VACANTE_A_PLANIFICACION') return false;
            if (n.enGestion) return false;
            if ((n.type === 'VACANTE_OPERATIVA' || n.type === 'TURA_EXTENSION') && n.tipoSolicitud === 'TURA' && n.parentEmpleadoId) {
                const target = resolveTuraExtensionOperacionesTarget(n, logic.processedData);
                if (target?.turaContiguous) return false;
            }
            return true;
        }),
    [empNovedades, logic.processedData]);
    // Nombre del operador actual (para marcar enGestion)
    const operatorName = useMemo(() => getAuth().currentUser?.email?.split('@')[0] || 'Operador', []);
    useEffect(() => {
        if (!empresaId || empresa === null) return; // esperar a que cargue el doc de empresa (migracionCompleta puede cambiar)
        const since = Timestamp.fromDate(new Date(Date.now() - 48 * 3600 * 1000));
        const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
        const q = scopeEmpresa
            ? query(collection(db, 'novedades'), where('empresaId', '==', empresaId), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(200))
            : query(collection(db, 'novedades'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(200));
        const unsub = onSnapshotFresh(q, snap => {
                const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                docs.sort((a: any, b: any) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
                setEmpNovedades(docs);
            }, err => {
                console.warn('[map-view] novedades listener error, reconectando:', err.code);
                setRefreshKey(k => k + 1);
            }
        );
        return () => unsub();
    }, [empresaId, empresa, migracionCompleta, refreshKey]);
    const recentlyRelievedRef = useRef<Set<string>>(new Set());
    const prevPendingCount = useRef(0);
    useEffect(() => {
        if (pendingNovedades.length > prevPendingCount.current) setNotifPanelOpen(true);
        prevPendingCount.current = pendingNovedades.length;
    }, [pendingNovedades.length]);

    // ── Auto-cerrar novedades VACANTE_PROTOCOLO_COBERTURA cuando el slot ya venció sin cobertura
    const autoExpiredRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        const nowMs = Date.now();
        const expired = empNovedades.filter((n: any) => {
            if (n.status === 'ATENDIDA') return false;
            if (n.type !== 'VACANTE_PROTOCOLO_COBERTURA') return false;
            if (autoExpiredRef.current.has(n.id)) return false;
            // Usamos shiftStart si existe; fallback a createdAt para alertas pre-fix sin shiftStart
            const shiftStartMs = n.shiftStart?.seconds
                ? n.shiftStart.seconds * 1000
                : n.endTime?.seconds
                    ? n.endTime.seconds * 1000
                    : n.shiftEnd?.seconds
                        ? n.shiftEnd.seconds * 1000
                        : n.createdAt?.seconds
                            ? n.createdAt.seconds * 1000
                            : null;
            const t120 = shiftStartMs ? shiftStartMs + 120 * 60000 : null;
            // T+120 es absoluto — se cierra independientemente de si la vacante sigue activa
            if (!t120 || nowMs < t120) return false;
            return true;
        });
        if (expired.length === 0) return;
        expired.forEach(async (n: any) => {
            autoExpiredRef.current.add(n.id);
            try {
                await updateDoc(doc(db, 'novedades', n.id), {
                    status: 'ATENDIDA',
                    atendidaAt: serverTimestamp(),
                    atendidaPor: 'Sistema',
                    resolution: 'NO_CUBIERTO',
                });
            } catch (e) {
                autoExpiredRef.current.delete(n.id);
                console.warn('[auto-expire] Error cerrando novedad vencida', e);
            }
        });
    }, [empNovedades]);

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

    const handleDismissAllByType = async (type: string) => {
        const toAtend = pendingNovedades.filter((n: any) => n.type === type);
        if (!toAtend.length) return;
        const auth = getAuth();
        const actorName = auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'Operador';
        try {
            const batch = writeBatch(db);
            toAtend.forEach((n: any) => {
                batch.update(doc(db, 'novedades', n.id), {
                    status: 'ATENDIDA', atendidaAt: serverTimestamp(),
                    atendidaPor: actorName, atendidaPorUid: auth.currentUser?.uid || null,
                });
            });
            await batch.commit();
            addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                action: 'DESCARTAR_NOVEDADES_TIPO', module: 'OPERACIONES', actorName,
                timestamp: serverTimestamp(),
                details: `Descartó ${toAtend.length} novedades tipo ${type}.`,
            }, empresaId)).catch(() => {});
            toast.success(`${toAtend.length} novedades descartadas`);
        } catch { toast.error('Error al descartar novedades'); }
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
            } else if (novedad.type === 'TURA_EXTENSION' || (novedad.type === 'VACANTE_OPERATIVA' && novedad.tipoSolicitud === 'TURA' && novedad.parentEmpleadoId)) {
                const target = resolveTuraExtensionOperacionesTarget(novedad, logic.processedData);
                if (target) {
                    logic.setViewTab('PLAN');
                    setHandoverData({ isOpen: true, shift: target });
                    toast.info(target.turaContiguous
                        ? `Turno extendido: ${target.employeeName}${target.turaExtensionRange ? ` · ${target.turaExtensionRange}` : ''}`
                        : `2º tramo TURA: ${target.employeeName}`);
                } else {
                    logic.setViewTab('PLAN');
                    toast.info('Buscá al guardia en PLAN — el TURA está anexado a su turno.');
                }
            } else if (
                novedad.type === 'REFUERZO_CLIENTE_PENDIENTE'
                || (novedad.type === 'VACANTE_OPERATIVA' && novedad.tipoSolicitud === 'RFZ')
                || (novedad.type === 'VACANTE_OPERATIVA' && novedad.actionTarget === 'PLANIFICACION')
            ) {
                const fecha = String(novedad.fecha || '').slice(0, 10);
                const [y, mo] = fecha.split('-').map(Number);
                const qs = new URLSearchParams();
                if (novedad.objectiveId) qs.set('objectiveId', String(novedad.objectiveId));
                if (novedad.clientId) qs.set('clientId', String(novedad.clientId));
                if (Number.isFinite(y) && y > 2000) qs.set('year', String(y));
                if (Number.isFinite(mo) && mo >= 1 && mo <= 12) qs.set('month', String(mo));
                void router.push(`/admin/planificacion/${qs.toString() ? `?${qs.toString()}` : ''}`);
                toast.info('Planificación — fila VACANTE RFZ: asigná guardia y publicá.');
            } else if (novedad.type === 'VACANTE_OPERATIVA') {
                const turnoIds: string[] = Array.isArray(novedad.turnoIds) ? novedad.turnoIds : [];
                const vacShift = turnoIds.length
                    ? logic.processedData.find((s: any) => turnoIds.includes(s.id))
                    : logic.processedData.find((s: any) =>
                        s.solicitudRefuerzoId === novedad.solicitudRefuerzoId ||
                        (s.origin === 'CLIENT_REQUEST' && s.objectiveId === novedad.objectiveId && s.isUnassigned)
                    );
                if (vacShift) {
                    setCoverageData({ isOpen: true, shift: vacShift });
                    logic.setViewTab('VACANTES');
                    toast.info(`Asigná guardia: ${novedad.title || novedad.tipoSolicitud || 'TURA'}`);
                } else {
                    logic.setViewTab('VACANTES');
                    toast.info(novedad.description || 'Buscá la vacante TURA en la pestaña VACANTES');
                }
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
    const [manualRetentionData, setManualRetentionData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [absenceDecisionData, setAbsenceDecisionData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [rrhhVacancyData, setRrhhVacancyData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [waData, setWaData] = useState<{isOpen: boolean, ctx: any}>({isOpen: false, ctx: {employeeName:'', phone:''}});
    const [showHelp, setShowHelp] = useState(false);
    const [showProtAlerts, setShowProtAlerts] = useState(false);
    const [detailNovedad, setDetailNovedad] = useState<any>(null);

    const handleMarkAbsent = async (shift: any) => {
        try {
            await updateDocForEmpresa('turnos', shift.id, { status: 'ABSENT', isAbsent: true }, empresaId, migracionCompleta);
            setAttendanceData({isOpen:false, shift:null});
            setCoverageData({isOpen:true, shift: shift});
        } catch (e) { toast.error("Error al marcar ausencia"); }
    };
    const handleVacancyCreated = (newVacancyShift: any) => { setInterruptData({isOpen:false, shift:null}); setCoverageData({isOpen:true, shift: newVacancyShift}); };
    const handleReportPlanning = async (shift: any) => { toast.info("Reportando..."); };
    const handleOpenWAMap = (shift: any) => {
        setWaData({ isOpen: true, ctx: { employeeName: shift.employeeName || '', phone: shift.phone || '', objectiveName: shift.objectiveName, horaInicio: shift.shiftDateObj ? new Date(shift.shiftDateObj).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false}) : '', horaFin: shift.endDateObj ? new Date(shift.endDateObj).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false}) : '' } });
    };
    const handleDeclareAbsentT5 = async (shift: any) => {
        const shiftEmpresaId = String(shift.empresaId || empresaId || '').trim();
        const shiftDate = shift.shiftDateObj instanceof Date ? shift.shiftDateObj : new Date(shift.shiftDateObj);
        const dayStart = new Date(shiftDate); dayStart.setHours(0,0,0,0);
        const dayEnd   = new Date(shiftDate); dayEnd.setHours(23,59,59,999);
        await updateDocForEmpresa('turnos', shift.id, { status: 'ABSENT', isAbsent: true, absenceType: 'MANUAL_OPS', absenceConfirmedBy: 'OPERACIONES', absenceConfirmedAt: serverTimestamp() }, empresaId, migracionCompleta);
        await addDoc(collection(db, 'ausencias'), stampEmpresaId({ employeeId: shift.employeeId, employeeName: shift.employeeName, clientId: shift.clientId || null, type: 'NO_PRESENTACION', startDate: Timestamp.fromDate(dayStart), endDate: Timestamp.fromDate(dayEnd), status: 'Pendiente', reason: `No presentación — ${shift.objectiveName} (${shift.positionName})`, hasCertificate: false, createdAt: serverTimestamp(), origin: 'OPERACIONES', shiftId: shift.id }, shiftEmpresaId));
        if (shift.employeeId) await addDoc(collection(db, 'user_notifications'), stampEmpresaId({ userId: shift.employeeId, type: 'AUSENCIA_DECLARADA', title: 'Ausencia registrada', read: false, body: `Tu ausencia en ${shift.objectiveName} fue registrada por Operaciones.`, objectiveId: shift.objectiveId, shiftId: shift.id, createdAt: serverTimestamp() }, shiftEmpresaId));
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'AUSENCIA_OPERATIVA', title: 'Ausencia declarada T+5', status: 'pending', employeeId: shift.employeeId, employeeName: shift.employeeName, clientId: shift.clientId || null, objectiveId: shift.objectiveId || null, shiftId: shift.id, objectiveName: shift.objectiveName || '', positionName: shift.positionName || '', description: `${shift.employeeName} no se presentó en ${shift.objectiveName} — ${shift.positionName}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, shiftEmpresaId));
        setCoverageData({ isOpen: true, shift });
        toast.success(`Ausencia de ${shift.employeeName} registrada.`);
    };
    const handleLateArrival = async (shift: any, etaTime: string) => {
        try { await updateDocForEmpresa('turnos', shift.id, { lateArrivalAt: serverTimestamp(), lateETA: etaTime }, empresaId, migracionCompleta); toast.info(`Llegada tarde de ${shift.employeeName} registrada. ETA: ${etaTime}`); }
        catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
    };

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
        /** Solo objetivos con geo real — no inventar Córdoba (apilaba todos los pines). */
        const onlyWithCoords = (arr: any[]) =>
            (arr || []).filter((o: any) => o != null && Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng)));
        if (logic.viewTab === 'TODOS') {
            const result = base.length ? base : allObjs;
            const withCoords = onlyWithCoords(result);
            return withCoords.length ? withCoords : objectivesWithCoords;
        }
        const ids = new Set((logic.listData || []).map((s: any) => s.objectiveId).filter(Boolean));
        const fromTab = base.filter((o: any) => ids.has(o.id));
        const combined = fromTab.length ? fromTab : base;
        const withCoords = onlyWithCoords(combined);
        return withCoords.length ? withCoords : objectivesWithCoords;
    }, [logic.filteredObjectives, logic.listData, logic.viewTab, logic.objectives, objectivesWithCoords]);

    return (
        <div className="h-screen w-screen overflow-hidden bg-slate-900 relative">
            <Head><title>COSP TACTICAL V1.0 · 31b309b</title></Head>
            <style>{POPUP_STYLES}</style>
            
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
                onOpenManualRetention={(s:any)=>setManualRetentionData({isOpen:true, shift:s})}
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
                // Guardias que no llegaron: T+5 → T+60
                const lateShiftsPanel = _hoy.filter((s:any) => (s.isLateNotified || s.isLateUnnotified) && !s.isFranco && !s.isAbsent);

                // Triage: urgentes vs PROT (automatizados, menos urgentes)
                const urgentNovedades = pendingNovedades.filter(n =>
                    n.type === 'AUSENCIA_CORTO_PLAZO' || n.type === 'AVISO_AUSENCIA_ANTICIPADA' ||
                    n.type === 'POSICION_SIN_RELEVO' || n.type === 'RETENCION_LARGA' || n.type === 'RELEVO_INMINENTE' ||
                    n.type === 'AUSENCIA_AUTO' || n.type === 'RELEVO_NO_PRESENTADO'
                );
                const protNovedades = pendingNovedades.filter(n => n.type === 'VACANTE_PROTOCOLO_COBERTURA');
                const otherNovedades = pendingNovedades.filter(n =>
                    !urgentNovedades.includes(n) && !protNovedades.includes(n)
                );
                const totalAlerts = priorityShiftsPanel.length + lateShiftsPanel.length + urgentNovedades.length + otherNovedades.length + protNovedades.length;

                const NOV_TYPE_META: Record<string, { label: string; bg: string; border: string }> = {
                    AUSENCIA_CORTO_PLAZO:        { label: 'URGENTE', bg: 'bg-red-600 text-white animate-pulse', border: 'border-l-red-600' },
                    AVISO_AUSENCIA_ANTICIPADA:   { label: 'ANTIC',   bg: 'bg-amber-100 text-amber-800',         border: 'border-l-amber-400' },
                    CONVOCATORIA_RETEN:          { label: 'CONV',    bg: 'bg-indigo-100 text-indigo-700',       border: 'border-l-indigo-500' },
                    FRANCO_TRABAJADO:            { label: 'CONV',    bg: 'bg-indigo-100 text-indigo-700',       border: 'border-l-indigo-500' },
                    VACANTE_PROTOCOLO_COBERTURA: { label: 'PROT',    bg: 'bg-orange-100 text-orange-700',       border: 'border-l-orange-500' },
                    AUSENCIA_AUTO:               { label: 'AUS',     bg: 'bg-rose-100 text-rose-700',           border: 'border-l-rose-500' },
                    AUSENCIA_OPERATIVA:          { label: 'AUS',     bg: 'bg-rose-100 text-rose-700',           border: 'border-l-rose-500' },
                    POSICION_SIN_RELEVO:         { label: 'REL',     bg: 'bg-amber-100 text-amber-700',         border: 'border-l-amber-500' },
                    RELEVO_NO_PRESENTADO:        { label: 'REL',     bg: 'bg-amber-100 text-amber-700',         border: 'border-l-amber-500' },
                    RETENCION_LARGA:             { label: 'REC',     bg: 'bg-orange-100 text-orange-800',       border: 'border-l-orange-600' },
                    RELEVO_INMINENTE:            { label: 'RELEVO',  bg: 'bg-blue-100 text-blue-800',           border: 'border-l-blue-600' },
                    RECARGO_12H:                 { label: 'REC+12',  bg: 'bg-orange-100 text-orange-800',       border: 'border-l-orange-600' },
                    RETENCION_DETECTADA:         { label: 'REC',     bg: 'bg-orange-100 text-orange-800',       border: 'border-l-orange-600' },
                    REFUERZO_CLIENTE_PENDIENTE:  { label: 'RFZ CLI', bg: 'bg-violet-100 text-violet-800',       border: 'border-l-violet-500' },
                    VACANTE_OPERATIVA:           { label: 'VAC RFZ', bg: 'bg-fuchsia-100 text-fuchsia-800',     border: 'border-l-fuchsia-500' },
                    TURA_EXTENSION:              { label: 'TURA', bg: 'bg-violet-100 text-violet-800',       border: 'border-l-violet-500' },
                };
                const getNovMeta = (t: string) => NOV_TYPE_META[t] || { label: 'NOV', bg: 'bg-slate-100 text-slate-600', border: 'border-l-slate-300' };

                const renderNovedad = (n: any) => {
                    const ts = n.createdAt?.seconds ? new Date(n.createdAt.seconds * 1000) : null;
                    const meta = getNovMeta(n.type);
                    return (
                        <div key={n.id}
                            onClick={() => setDetailNovedad(n)}
                            className={`px-3 py-2 flex items-center gap-2 border-l-4 ${meta.border} border-b border-slate-50 hover:bg-slate-50/80 transition-colors cursor-pointer`}>
                            <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-bold text-slate-800 leading-snug truncate">
                                    {n.title
                                        ? String(n.title)
                                        : n.employeeName && n.objectiveName
                                            ? <>{n.employeeName} <span className="text-slate-400 font-normal">·</span> {n.objectiveName}</>
                                            : n.objectiveName || n.employeeName || n.type}
                                    {n.positionName && <span className="text-slate-400 font-normal text-[9px]"> · {n.positionName}</span>}
                                </p>
                                <p className="text-[9px] text-slate-400 leading-tight truncate">{n.description || '-'}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <span className="text-[9px] text-slate-400 font-mono">
                                    {ts ? ts.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Argentina/Cordoba'}) : '--'}
                                </span>
                                {n.employeePhone && (
                                    <button onClick={(e) => { e.stopPropagation(); openWhatsApp(n.employeePhone, waMensaje.bienvenida(n.employeeName||'')); }}
                                        className="p-1.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-100">
                                        <MessageCircle size={10}/>
                                    </button>
                                )}
                                <button onClick={(e) => { e.stopPropagation(); handleAtenderNovedad(n); }}
                                    className="p-1.5 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors" title="Atender">
                                    <CheckCircle size={10}/>
                                </button>
                            </div>
                        </div>
                    );
                };

                const renderNovedasGrouped = (items: any[]) => {
                    const groups: { type: string; items: any[] }[] = [];
                    const seen = new Map<string, any[]>();
                    items.forEach((n: any) => {
                        if (!seen.has(n.type)) { seen.set(n.type, []); groups.push({ type: n.type, items: seen.get(n.type)! }); }
                        seen.get(n.type)!.push(n);
                    });
                    return groups.map(({ type, items: groupItems }) => {
                        const meta = getNovMeta(type);
                        return (
                            <div key={type}>
                                <div className="px-3 py-1 flex items-center gap-2 bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${meta.bg}`}>{meta.label}</span>
                                    <span className="text-[9px] font-bold text-slate-500 flex-1 truncate">{type.replace(/_/g,' ')}</span>
                                    <span className="text-[9px] text-slate-400 font-mono">{groupItems.length}</span>
                                    {groupItems.length > 1 && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDismissAllByType(type); }}
                                            className="text-[9px] font-bold text-slate-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors shrink-0"
                                            title={`Descartar todas (${groupItems.length})`}
                                        >✕ todas</button>
                                    )}
                                </div>
                                {groupItems.map(renderNovedad)}
                            </div>
                        );
                    });
                };

                return !notifPanelOpen ? (
                    <button onClick={() => setNotifPanelOpen(true)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg font-black uppercase text-sm transition-all hover:scale-105 ${totalAlerts > 0 ? 'bg-rose-600 text-white animate-pulse' : 'bg-slate-800 text-white'}`}>
                        <Siren size={15} className={totalAlerts > 0 ? 'animate-pulse' : ''}/>
                        Alertas
                        <span className={`text-xs font-black px-2 py-0.5 rounded-full ${totalAlerts > 0 ? 'bg-white text-rose-600' : 'bg-white/20 text-white'}`}>{totalAlerts}</span>
                    </button>
                ) : (
                    <div className="w-[520px] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-200 animate-in slide-in-from-bottom-4 max-h-[80vh]">
                        <div className="px-4 py-3 bg-slate-900 rounded-t-2xl flex items-center gap-2">
                            <Siren size={14} className="text-rose-400 shrink-0 animate-pulse"/>
                            <span className="font-black uppercase text-xs text-white flex-1 tracking-wide">Alertas y Prioridad</span>
                            {totalAlerts > 0 && <span className="bg-rose-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full">{totalAlerts}</span>}
                            <button onClick={() => setNotifPanelOpen(false)} className="p-1 hover:bg-white/10 rounded-lg transition-colors"><X size={14} className="text-slate-400"/></button>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {priorityShiftsPanel.length > 0 && (
                                <div className="border-b border-slate-200">
                                    <div className="px-3 py-1.5 bg-rose-50 flex items-center gap-1.5">
                                        <AlertTriangle size={10} className="text-rose-600 shrink-0"/>
                                        <span className="text-[9px] font-black text-rose-700 uppercase flex-1">Acción inmediata</span>
                                        <span className="text-[9px] font-bold text-rose-500">{priorityShiftsPanel.length} turno{priorityShiftsPanel.length > 1 ? 's' : ''}</span>
                                    </div>
                                    {priorityShiftsPanel.map((s: any) => (
                                        <div key={s.id} className="px-3 py-2 flex items-center gap-2 border-l-4 border-l-rose-500 border-b border-slate-50 bg-white hover:bg-rose-50/30 transition-colors">
                                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${s.manualRetentionType ? 'bg-amber-100 text-amber-700' : s.isRetention ? 'bg-orange-100 text-orange-700' : s.isEarlyStart || s.isAwaitingCoverageCheckIn ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-100 text-rose-700'}`}>{(s.employeeName || '?')[0]}</div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[11px] font-bold text-slate-800 leading-snug">
                                                    {s.employeeName || 'Desconocido'}
                                                    <span className={`ml-1.5 text-[9px] font-black px-1.5 rounded ${s.manualRetentionType ? 'bg-amber-100 text-amber-700' : s.isRetention ? 'bg-orange-100 text-orange-700' : s.isEarlyStart ? 'bg-indigo-100 text-indigo-700' : s.isAwaitingCoverageCheckIn ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-100 text-rose-700'}`}>
                                                        {s.manualRetentionType === 'extended' ? `+${s.manualRetentionHours}h MAN` : s.manualRetentionType === 'open' ? 'MAN INDEF' : s.isRetention ? 'RECARGO AUTO' : s.isEarlyStart ? 'ADELANTADO' : s.isAwaitingCoverageCheckIn ? 'CONVOCADO' : 'INMINENTE'}
                                                    </span>
                                                </p>
                                                <p className="text-[10px] text-slate-400 leading-tight">{s.objectiveName} · {s.positionName} · <span className="font-mono">{formatTimeSimple(s.shiftDateObj)}</span></p>
                                            </div>
                                            <div className="flex gap-1 shrink-0">
                                                {s.isPresent ? (<>
                                                    <button onClick={() => { setNotifPanelOpen(false); setManualRetentionData({isOpen:true, shift:s}); }} className="p-1.5 bg-orange-50 text-orange-600 border border-orange-200 rounded-lg hover:bg-orange-100" title="Retención manual"><Timer size={11}/></button>
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

                            {lateShiftsPanel.length > 0 && (
                                <div className="border-b border-slate-200">
                                    <div className="px-3 py-1.5 bg-amber-50 flex items-center gap-1.5">
                                        <Clock size={10} className="text-amber-600 shrink-0"/>
                                        <span className="text-[9px] font-black text-amber-700 uppercase flex-1">No llegó · tardanza</span>
                                        <span className="text-[9px] font-bold text-amber-500">{lateShiftsPanel.length} guardia{lateShiftsPanel.length > 1 ? 's' : ''}</span>
                                    </div>
                                    {lateShiftsPanel.map((s: any) => {
                                        const minutesPast = Math.round(s.minutesPastStart || 0);
                                        return (
                                            <div key={s.id} className="px-3 py-2 flex items-center gap-2 border-l-4 border-l-amber-500 border-b border-slate-50 bg-white hover:bg-amber-50/30 transition-colors">
                                                <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[10px] font-black shrink-0">{(s.employeeName || '?')[0]}</div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[11px] font-bold text-slate-800 leading-snug">
                                                        {s.employeeName || 'Desconocido'}
                                                        <span className="ml-1.5 text-[9px] font-black px-1.5 rounded bg-amber-100 text-amber-700">+{minutesPast}min</span>
                                                    </p>
                                                    <p className="text-[10px] text-slate-400 leading-tight">{s.objectiveName} · {s.positionName} · <span className="font-mono">{formatTimeSimple(s.shiftDateObj)}</span></p>
                                                </div>
                                                <div className="flex gap-1 shrink-0">
                                                    <button onClick={() => { setNotifPanelOpen(false); setHandoverData({isOpen:true, shift:s}); }} className="p-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600" title="Dar presente (tarde)"><PlayCircle size={11}/></button>
                                                    {s.isLateUnnotified && <button onClick={() => { setNotifPanelOpen(false); setAbsenceDecisionData({isOpen:true, shift:s}); }} className="p-1.5 bg-amber-100 text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-200" title="Decidir"><AlertTriangle size={11}/></button>}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Novedades urgentes */}
                            {urgentNovedades.length > 0 && (
                                <div className="border-b border-slate-200">
                                    <div className="px-3 py-1.5 bg-red-50 flex items-center gap-1.5">
                                        <BellRing size={10} className="text-red-600 shrink-0"/>
                                        <span className="text-[9px] font-black text-red-700 uppercase flex-1">Novedades urgentes</span>
                                        <span className="text-[9px] font-bold text-red-500">{urgentNovedades.length}</span>
                                    </div>
                                    {renderNovedasGrouped(urgentNovedades)}
                                </div>
                            )}

                            {/* Novedades PROT */}
                            {protNovedades.length > 0 && (
                                <div className="border-b border-slate-200">
                                    <div className="px-3 py-1.5 bg-orange-50 flex items-center gap-1.5">
                                        <Shield size={10} className="text-orange-600 shrink-0"/>
                                        <span className="text-[9px] font-black text-orange-700 uppercase flex-1">Protocolos activos</span>
                                        <span className="text-[9px] font-bold text-orange-500">{protNovedades.length}</span>
                                    </div>
                                    {renderNovedasGrouped(protNovedades)}
                                </div>
                            )}

                            {/* Otras novedades */}
                            {otherNovedades.length > 0 && (
                                <div>
                                    <div className="px-3 py-1.5 bg-slate-50 flex items-center gap-1.5">
                                        <CheckCircle size={10} className="text-slate-500 shrink-0"/>
                                        <span className="text-[9px] font-black text-slate-500 uppercase flex-1">Otras novedades</span>
                                        <span className="text-[9px] font-bold text-slate-400">{otherNovedades.length}</span>
                                    </div>
                                    {renderNovedasGrouped(otherNovedades)}
                                </div>
                            )}

                            {totalAlerts === 0 && (
                                <div className="p-6 text-center">
                                    <CheckCircle size={24} className="mx-auto mb-2 text-emerald-400 opacity-50"/>
                                    <p className="text-xs font-bold text-slate-400">Sin alertas pendientes</p>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })()}
            </div>

            {/* ── Modales ── */}
            <CheckOutModal
                isOpen={checkoutData.isOpen}
                onClose={() => setCheckoutData({isOpen:false, shift:null})}
                onConfirm={(nov: string|null) => { if (checkoutData.shift?.id) logic.handleAction('CHECKOUT', checkoutData.shift.id, nov); setCheckoutData({isOpen:false, shift:null}); }}
                employeeName={checkoutData.shift?.employeeName}
                shift={checkoutData.shift}
            />
            <AttendanceModal
                isOpen={attendanceData.isOpen}
                onClose={() => setAttendanceData({isOpen:false, shift:null})}
                shift={attendanceData.shift}
                onMarkAbsent={handleMarkAbsent}
            />
            <HandoverModal
                isOpen={handoverData.isOpen}
                onClose={() => setHandoverData({isOpen:false, shift:null})}
                incomingShift={handoverData.shift}
                logic={logic}
                recentlyRelievedIds={recentlyRelievedRef.current}
                onRelieved={(id: string) => { recentlyRelievedRef.current.add(id); setHandoverData({isOpen:false, shift:null}); }}
            />
            <InterruptModal
                isOpen={interruptData.isOpen}
                onClose={() => setInterruptData({isOpen:false, shift:null})}
                shift={interruptData.shift}
                logic={logic}
                onVacancyCreated={handleVacancyCreated}
            />
            <CoverageModal
                isOpen={coverageData.isOpen}
                onClose={() => setCoverageData({isOpen:false, shift:null})}
                absenceShift={coverageData.shift}
                logic={logic}
            />
            <WorkedDayOffModal
                isOpen={workedFrancoData.isOpen}
                onClose={() => setWorkedFrancoData({isOpen:false, shift:null})}
                shift={workedFrancoData.shift}
                availableShifts={logic.processedData}
                referenceDate={logic.now}
            />
            <ManualRetentionModal isOpen={manualRetentionData.isOpen} onClose={() => setManualRetentionData({isOpen:false,shift:null})} shift={manualRetentionData.shift}/>
            <AbsenceDecisionModal
                isOpen={absenceDecisionData.isOpen}
                onClose={() => setAbsenceDecisionData({isOpen:false, shift:null})}
                shift={absenceDecisionData.shift}
                onDeclareAbsent={handleDeclareAbsentT5}
                onLateArrival={handleLateArrival}
                onOpenWA={handleOpenWAMap}
            />
            <RRHHVacancyModal
                isOpen={rrhhVacancyData.isOpen}
                onClose={() => setRrhhVacancyData({isOpen:false, shift:null})}
                shift={rrhhVacancyData.shift}
                onCoverageProtocol={(s:any) => setCoverageData({isOpen:true, shift:s})}
                onSendToPlanning={(s:any) => { logic.handleAction('SEND_TO_PLANNING', s.id, null); setRrhhVacancyData({isOpen:false, shift:null}); }}
            />
            <WAComposeModal
                isOpen={waData.isOpen}
                onClose={() => setWaData({isOpen:false, ctx:{employeeName:'', phone:''}})}
                ctx={waData.ctx}
            />
            {detailNovedad && (
                <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4" onClick={() => setDetailNovedad(null)}>
                    <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-black uppercase tracking-widest text-slate-500">
                                {detailNovedad.title ? String(detailNovedad.title).slice(0, 48) : (TYPE_META_MAP as any)[detailNovedad?.type]?.label || detailNovedad?.type}
                            </span>
                            <button onClick={() => setDetailNovedad(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                                <X size={16}/>
                            </button>
                        </div>
                        {detailNovedad.employeeName && (
                            <p className="font-bold text-slate-800 text-sm mb-1">{detailNovedad.employeeName}</p>
                        )}
                        {detailNovedad.objectiveName && (
                            <p className="text-xs text-slate-500 mb-1">{detailNovedad.objectiveName}</p>
                        )}
                        {(detailNovedad.type === 'REFUERZO_CLIENTE_PENDIENTE' || detailNovedad.type === 'VACANTE_OPERATIVA') && (
                            <div className="text-xs text-slate-600 mb-3 space-y-1">
                                {detailNovedad.fecha && <p><span className="text-slate-400">Fecha:</span> {detailNovedad.fecha}</p>}
                                {(detailNovedad.startTime || detailNovedad.endTime) && (
                                    <p><span className="text-slate-400">Horario:</span> {detailNovedad.startTime || ''}{detailNovedad.endTime ? `–${detailNovedad.endTime}` : ''}</p>
                                )}
                                {detailNovedad.horasVendidasEstimadas != null && (
                                    <p><span className="text-slate-400">Hs. pactadas:</span> {detailNovedad.horasVendidasEstimadas}h</p>
                                )}
                            </div>
                        )}
                        {detailNovedad.description && (
                            <p className="text-sm text-slate-600 mb-4 leading-relaxed">{detailNovedad.description}</p>
                        )}
                        <button
                            onClick={() => { handleAtenderNovedad(detailNovedad); setDetailNovedad(null); }}
                            className="w-full py-2.5 bg-slate-800 text-white text-sm font-bold rounded-xl hover:bg-slate-700 transition-colors"
                        >
                            ATENDER
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
