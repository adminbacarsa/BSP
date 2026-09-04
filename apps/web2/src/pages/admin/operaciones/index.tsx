import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { 
    Radio, Search, Layers, Maximize2, Minimize2, MonitorUp, Building2, Shield,
    Clock, Siren, CheckCircle, LogOut, AlertTriangle, ClipboardList, Printer,
    Phone, MessageCircle, Calendar, ChevronDown, ChevronRight, ChevronUp,
    Filter, Send, PlayCircle, EyeOff, X, Briefcase, UserX, CornerUpLeft,
    MapPin, UserCheck, Navigation, Users, ArrowLeftRight, BellRing, ChevronLeft, XCircle,
    FileText, Volume2, VolumeX, RefreshCw, AlarmClock, Loader2, Timer
} from 'lucide-react';
import { toast } from 'sonner';
import { useOperacionesMonitor } from '@/hooks/useOperacionesMonitor';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useAutoMonitor } from '@/hooks/useAutoMonitor';
import { useOperatorSession } from '@/hooks/useOperatorSession';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { POPUP_STYLES } from '@/components/operaciones/mapStyles';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { doc, updateDoc, serverTimestamp, addDoc, collection, setDoc, Timestamp, writeBatch, query, where, orderBy, limit, getDocs, waitForPendingWrites } from 'firebase/firestore';
import { openWhatsApp, waMensaje } from '@/lib/whatsapp';
import { WAComposeModal, type WAComposeContext } from '@/components/common/WAComposeModal';
import { db, onSnapshotFresh } from '@/lib/firebase';
import { getAuth } from 'firebase/auth';
import { resolveTuraExtensionOperacionesTarget } from '@/lib/refuerzo/turaContiguity';
import { updateDocForEmpresa, stampEmpresaId, assertDocBelongsToEmpresa, shouldScopeQueriesToEmpresa } from '@/lib/multiempresa';
import { registrarPresenciaOps } from '@/services/registrarPresenciaOps';

const OperacionesMap = dynamic(() => import('@/components/operaciones/OperacionesMap'), { loading: () => <div className="h-full flex items-center justify-center text-slate-400">Cargando Mapa...</div>, ssr: false });
import { DebugPanel } from '@/components/operaciones/DebugPanel';

// --- HELPERS ---
const toDate = (d: any) => { if (!d) return new Date(); if (d instanceof Date) return d; if (d.seconds) return new Date(d.seconds * 1000); return new Date(d); };
const formatTimeSimple = (dateObj: any) => { try { return toDate(dateObj).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' }); } catch(e) { return '-'; } };
const formatDateShort = (dateObj: any) => { try { return toDate(dateObj).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Cordoba' }).toUpperCase(); } catch (e) { return '--/--'; } };
const formatTimeRange = (start: any, end: any) => { try { return `${toDate(start).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', timeZone: 'America/Argentina/Cordoba'})} - ${toDate(end).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', timeZone: 'America/Argentina/Cordoba'})}`; } catch { return '--:--'; } };
const displayShiftTimeRange = (shift: any) => {
    if (shift?.turaContiguous && shift?.turaExtensionRange) return shift.turaExtensionRange;
    return formatTimeRange(shift.shiftDateObj, shift.endDateObj);
};
const fmt24h = (dateObj: any) => { try { return toDate(dateObj).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Cordoba' }); } catch(e) { return '-'; } };
const isSameDay = (d1: any, d2: any) => { if (!d1 || !d2) return false; return toDate(d1).toLocaleDateString('en-CA') === toDate(d2).toLocaleDateString('en-CA'); };
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => { if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity; const R = 6371; const dLat = (lat2 - lat1) * (Math.PI / 180); const dLon = (lon2 - lon1) * (Math.PI / 180); const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2); const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); return R * c; };
const estimateEta = (dist: number) => Math.round((dist / 30) * 60);

const getRefuerzoLabel = (shift: any): 'RFZ' | 'TURA' | null => {
    const code = String(shift?.code || '').toUpperCase();
    if (code === 'RFZ' || shift?.isRfzVacante) return 'RFZ';
    if (code === 'TURA') return 'TURA';
    const type = String(shift?.type || '').toUpperCase();
    if (type === 'RFZ') return 'RFZ';
    if (type === 'TURA') return 'TURA';
    return null;
};

const getGuardAvatarLabel = (shift: any, name: string): string => {
    const ref = getRefuerzoLabel(shift);
    if (ref) return ref;
    if (shift?.isUnassigned && !shift?.isReportedToPlanning) return '!';
    return (name[0] || '?').toUpperCase();
};

const getGuardAvatarClass = (shift: any): string => {
    const ref = getRefuerzoLabel(shift);
    if (ref === 'RFZ') return 'bg-red-100 text-red-700';
    if (ref === 'TURA') return 'bg-violet-100 text-violet-700';
    if (shift?.isUnassigned && !shift?.isReportedToPlanning) return 'bg-rose-100 text-rose-600';
    return 'bg-slate-200 text-slate-600';
};

// --- COMPONENTE LISTA ---
const SectionList = ({ title, color, expanded, onToggle, items, onAction, onWhatsapp, onPhone, context }: any) => {
    const styles: any = { cyan: { border: 'border-cyan-200', dot: 'bg-cyan-500', text: 'text-cyan-700', bg: 'bg-cyan-50', btn: 'bg-cyan-600 hover:bg-cyan-700' }, purple: { border: 'border-purple-200', dot: 'bg-purple-500', text: 'text-purple-700', bg: 'bg-purple-50', btn: 'bg-purple-600 hover:bg-purple-700' }, slate: { border: 'border-slate-200', dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-white', btn: 'bg-slate-800 hover:bg-slate-900' } };
    const s = styles[color] || styles.slate;
    return ( <section className={`relative pl-6 border-l-2 ${s.border}`}> <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white ${s.dot}`}></div> <h4 className={`text-xs font-black uppercase mb-2 cursor-pointer flex items-center gap-2 ${s.text}`} onClick={onToggle}> {title} {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} </h4> {expanded && ( <div className="mt-2 space-y-2 max-h-48 overflow-y-auto custom-scrollbar p-1"> {items?.length > 0 ? items.map((e:any) => ( <div key={e.id} className={`flex justify-between items-center p-2 border rounded-lg shadow-sm ${s.bg}`}> <div> <span className="text-xs font-bold text-slate-800 block">{e.fullName || e.employeeName}</span> {context === 'INTERCAMBIO' && <span className="text-[10px] text-purple-700 block">{e.objectiveName} (Quedan: {e.remainingGuards})</span>} {e.distance !== undefined && e.distance < 1000 && ( <div className="flex items-center gap-2 mt-0.5"> <span className="text-[9px] bg-white border px-1.5 rounded text-slate-500 flex items-center gap-1"><Navigation size={8}/> {e.distance.toFixed(1)} km</span> <span className="text-[9px] text-slate-400">~{e.eta} min</span> </div> )} </div> <div className="flex gap-1"> <button onClick={()=>onWhatsapp(e, context)} className="p-1.5 bg-white text-emerald-600 border rounded hover:bg-emerald-50"><MessageCircle size={14}/></button> <button onClick={()=>onPhone(e)} className="p-1.5 bg-white text-blue-600 border rounded hover:bg-blue-50"><Phone size={14}/></button> <button onClick={()=>onAction(e)} className={`px-2 py-1.5 text-white text-[10px] font-bold rounded shadow-sm ${s.btn}`}> {context === 'INTERCAMBIO' ? 'MOVER' : 'ASIGNAR'} </button> </div> </div> )) : <p className="text-[10px] text-slate-400 italic">No hay candidatos.</p>} </div> )} </section> );
};

// --- MODALES (LÓGICA OPERATIVA) ---
const HandoverModal = ({ isOpen, onClose, incomingShift, logic, onOpenSwap, recentlyRelievedIds, onRelieved }: any) => {
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = !!(empresa as any)?.migracionCompleta;
    const [saving, setSaving] = React.useState(false);
    if (!isOpen || !incomingShift) return null;
    const now = new Date();
    const start = toDate(incomingShift.shiftDateObj);
    const end = toDate(incomingShift.endDateObj);
    const diffMin = (now.getTime() - start.getTime()) / 60000;
    let status = 'ON_TIME';
    if (!incomingShift.isReten && diffMin > 5) status = 'LATE';

    // Límite de 60 min para guardias ya marcados ausentes
    const LATE_LIMIT_MIN = 60;
    const wasAbsent = incomingShift.isAbsent === true;
    // Detectar si el turno ya fue cubierto por otro guardia — DEBE estar ANTES de tooLate (TDZ fix)
    const isCovered = incomingShift.status === 'COVERED' || !!incomingShift.coveredByEmployeeId;
    // Solo bloquear DAR PRESENTE si el turno está cubierto (hay otro haciendo su trabajo)
    const tooLate = wasAbsent && diffMin > LATE_LIMIT_MIN && isCovered;

    const samePost = (s: any) =>
        s.objectiveId === incomingShift.objectiveId &&
        normPosName(s.positionName) === normPosName(incomingShift.positionName);

    const overlapsSlot = (s: any) => {
        let sStart = toDate(s.shiftDateObj).getTime();
        let sEnd = toDate(s.endDateObj).getTime();
        let iStart = start.getTime();
        let iEnd = end.getTime();
        if (sEnd <= sStart) sEnd += 86400000;
        if (iEnd <= iStart) iEnd += 86400000;
        return sStart < iEnd && iStart < sEnd;
    };

    // Candidatos a relevar:
    // 1. Guardias en retención (siempre — llevan tiempo extra esperando)
    // 2. Guardias a ≤15 min de terminar su turno (están por salir)
    // Filtro de duración: solo guardias con turno compatible (±90 min) al del entrante
    // Ordenados por FIFO: quien lleva más minutos trabajados se va primero
    const incomingDurMin = (() => {
        const iS = toDate(incomingShift.shiftDateObj).getTime();
        let iE = toDate(incomingShift.endDateObj).getTime();
        if (iE <= iS) iE += 86400000;
        return (iE - iS) / 60000;
    })();

    const activeGuards = logic.processedData
        .filter((s: any) => {
            if (s.id === incomingShift.id || !samePost(s) || !s.isPresent || s.isCompleted || recentlyRelievedIds?.has(s.id)) return false;
            // Filtro duración compatible (±90 min)
            const sStart = toDate(s.shiftDateObj).getTime();
            let sEnd = toDate(s.endDateObj).getTime();
            if (sEnd <= sStart) sEnd += 86400000;
            const sDurMin = (sEnd - sStart) / 60000;
            if (Math.abs(sDurMin - incomingDurMin) > 90) return false;
            if (s.isRetention) {
                // Solo retenidos cuyo turno terminó a ≤45 min antes del turno entrante.
                // Evita mostrar guardias retenidos de franjas horarias anteriores.
                const scheduledEnd = toDate(s.endDateObj).getTime();
                return scheduledEnd >= start.getTime() - 45 * 60000;
            }
            const minutesUntilEnd = (toDate(s.endDateObj).getTime() - now.getTime()) / 60000;
            return minutesUntilEnd <= 15;
        })
        .sort((a: any, b: any) => (b.totalMinutesWorked ?? 0) - (a.totalMinutesWorked ?? 0)); // FIFO: más tiempo → primero

    const sla = (logic.servicesSLA || []).find((s: any) => s.objectiveId === incomingShift.objectiveId);
    const pos = sla?.positions?.find((p: any) => normPosName(p.name) === normPosName(incomingShift.positionName));
    const positionCapacity = Math.max(1, Number(pos?.quantity) || 1);
    const mustRelevar = activeGuards.length >= positionCapacity;

    // ── INTERCAMBIO DE TURNOS ──────────────────────────────────────────────
    // Cuando Guard A llega tarde (>60 min) y su turno fue cubierto por Guard B,
    // Guard A puede tomar el próximo turno de Guard B como compensación.
    const handleIntercambio = async () => {
        try {
            const coveringEmpId = incomingShift.coveredByEmployeeId;
            if (!coveringEmpId) {
                toast.error('No hay guardia cubridor registrado. Verificá el turno.');
                return;
            }
            // Buscar el turno planificado de Guard B que aún no inició
            const today = new Date();
            const guardBNextShift = logic.processedData.find((s: any) =>
                s.employeeId === coveringEmpId &&
                !s.isPresent && !s.isCompleted && !s.isAbsent &&
                isSameDay(s.shiftDateObj, today) &&
                s.id !== incomingShift.id
            );
            if (!guardBNextShift) {
                toast.error('No se encontró turno disponible para el intercambio. Guard B no tiene turno pendiente hoy.');
                return;
            }
            // Obtener nombre del cubridor
            const coveringEmp = (logic.employees || []).find((e: any) => e.id === coveringEmpId);
            const coveringName = coveringEmp?.fullName || coveringEmp?.name || coveringEmpId;

            const batch = writeBatch(db);
            const nowTs = serverTimestamp();

            // 1. Reasignar el turno de Guard B a Guard A
            batch.update(doc(db, 'turnos', guardBNextShift.id), {
                employeeId:          incomingShift.employeeId,
                employeeName:        incomingShift.employeeName,
                origin:              'INTERCAMBIO',
                intercambiadoPor:    coveringEmpId,
                intercambiadoPorNombre: coveringName,
                intercambioAt:       nowTs,
                originalEmployeeId:  coveringEmpId,
            });
            // 2. Marcar turno original de Guard A como resuelto por intercambio
            batch.update(doc(db, 'turnos', incomingShift.id), {
                coverageType:         'INTERCAMBIO',
                intercambioWith:      guardBNextShift.id,
                intercambioAt:        nowTs,
            });
            await batch.commit();

            // 3. Notificaciones a ambos guardias
            const shiftEmpresaId = String(incomingShift.empresaId || empresaId || '').trim();
            await addDoc(collection(db, 'user_notifications'), stampEmpresaId({
                userId: incomingShift.employeeId,
                type: 'INTERCAMBIO',
                title: 'Intercambio de turno',
                body: `Cubrís el turno de ${coveringName} en ${guardBNextShift.objectiveName} (${formatTimeSimple(guardBNextShift.shiftDateObj)} - ${formatTimeSimple(guardBNextShift.endDateObj)}).`,
                read: false, createdAt: nowTs,
            }, shiftEmpresaId));
            await addDoc(collection(db, 'user_notifications'), stampEmpresaId({
                userId: coveringEmpId,
                type: 'INTERCAMBIO',
                title: 'Intercambio de turno',
                body: `${incomingShift.employeeName} tomó tu turno de ${guardBNextShift.objectiveName}. Tu turno de la mañana queda registrado.`,
                read: false, createdAt: nowTs,
            }, shiftEmpresaId));

            // 4. Audit log
            await addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                action: 'INTERCAMBIO_TURNO',
                module: 'OPERACIONES',
                actorName: 'Operador',
                timestamp: nowTs,
                details: `Intercambio: ${incomingShift.employeeName} toma turno de ${coveringName} en ${guardBNextShift.objectiveName} (${formatTimeSimple(guardBNextShift.shiftDateObj)}-${formatTimeSimple(guardBNextShift.endDateObj)})`,
            }, shiftEmpresaId));

            toast.success(`Intercambio realizado. ${incomingShift.employeeName} cubre el turno de ${coveringName}.`);
            onClose();
        } catch (e: any) { toast.error('Error en intercambio: ' + (e?.message || String(e))); }
    };

    const handleConfirm = (mode: 'auto' | 'override' | 'skip', prevShiftId?: string | null) => {
        if (saving) return;
        if (mustRelevar && mode === 'skip' && status !== 'LATE') {
            toast.error(`Puesto completo (${positionCapacity} pax). Usá auto-relevo o elegí a quién relevar.`);
            return;
        }
        if (mustRelevar && mode === 'skip' && status === 'LATE') {
            toast.warning(`${incomingShift.employeeName} ingresó. Hay guardias en retención — relevalos manualmente.`);
        }
        if (!incomingShift?.id) {
            toast.error('Turno sin ID — no se puede registrar el ingreso.');
            return;
        }

        const shiftEmp = String(incomingShift.empresaId || '').trim();
        if (migracionCompleta && empresaId && shiftEmp && shiftEmp !== empresaId) {
            toast.error(`Operación bloqueada: el turno pertenece a «${shiftEmp}», no a «${empresaId}».`);
            return;
        }
        if (mode === 'override' && prevShiftId) {
            const prev = logic.processedData.find((s: any) => s.id === prevShiftId);
            const prevEmp = String(prev?.empresaId || '').trim();
            if (migracionCompleta && empresaId && prevEmp && prevEmp !== empresaId) {
                toast.error(`Operación bloqueada: el turno saliente pertenece a otra empresa.`);
                return;
            }
        }

        setSaving(true);
        if (mode === 'override' && prevShiftId) onRelieved?.(prevShiftId);
        else onClose();
        toast.success(
            mode === 'skip'
                ? (status === 'LATE' ? 'Ingreso tarde registrado (sin relevo).' : 'Ingreso registrado (sin relevo).')
                : mode === 'override'
                    ? (status === 'LATE' ? 'Ingreso tarde y relevo registrados.' : 'Ingreso y relevo registrados.')
                    : (status === 'LATE' ? 'Ingreso tarde — relevo automático FIFO.' : 'Ingreso — relevo automático FIFO.'),
        );

        void registrarPresenciaOps({
            shiftId: incomingShift.id,
            source: 'OPERATIONS',
            skipAutoRelevo: mode === 'skip',
            overrideRelieveShiftId: mode === 'override' && prevShiftId ? prevShiftId : mode === 'skip' ? null : undefined,
        }).then((res) => {
            if (res.alreadyPresent) toast.message('El turno ya estaba marcado presente.');
            else if (mode === 'auto' && res.relieved) {
                toast.success(`Relevó a ${res.relieved.employeeName} (FIFO).`);
                onRelieved?.(res.relieved.shiftId);
            } else if (mode === 'auto' && !res.relieved) {
                toast.message('Presente OK — no había saliente para relevar.');
            }
        }).catch((e: any) => {
            toast.error('Error al guardar ingreso: ' + (e?.message || e?.code || String(e)));
        }).finally(() => setSaving(false));
    };

    return (
        <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
                {/* Header con avatar */}
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
                {/* Chips contextuales */}
                <div className="px-4 pt-3 pb-2 flex flex-wrap gap-1.5">
                    <span className="flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
                        <MapPin size={9}/> {incomingShift.objectiveName || '—'}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                        <Shield size={9}/> {incomingShift.positionName || '—'}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                        <Clock size={9}/> {formatTimeRange(incomingShift.shiftDateObj, incomingShift.endDateObj)}
                    </span>
                </div>
                <div className="px-4 pb-5">
                    {/* CASO: turno cubierto o >60 min */}
                    {(tooLate || isCovered) ? (
                        <div className="space-y-3">
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                                <p className="text-sm font-bold text-amber-800">
                                    <b>{incomingShift.employeeName}</b> llegó con {Math.round(diffMin)} min de retraso.
                                </p>
                                {isCovered && (
                                    <p className="text-xs text-amber-700 mt-1">
                                        Su turno ya fue cubierto por{' '}
                                        <b>{incomingShift.coveredByEmployeeName || 'otro guardia'}</b>.
                                    </p>
                                )}
                                {tooLate && !isCovered && (
                                    <p className="text-xs text-amber-700 mt-1">
                                        Pasaron más de {LATE_LIMIT_MIN} minutos desde el inicio del turno.
                                    </p>
                                )}
                            </div>
                            <p className="text-xs text-slate-500 text-center">¿Qué hacemos con {incomingShift.employeeName}?</p>
                            <button onClick={handleIntercambio}
                                className="w-full py-3.5 bg-indigo-600 text-white font-black rounded-xl hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 text-sm">
                                <ArrowLeftRight size={16}/> INTERCAMBIO DE TURNO
                            </button>
                            <p className="text-[10px] text-slate-400 text-center">
                                Toma el turno de quien lo cubrió · Ambos quedan con un turno trabajado
                            </p>
                            <button onClick={onClose} className="w-full py-2 text-xs text-slate-400 hover:text-slate-600 transition-colors">
                                Cancelar — gestionar manualmente
                            </button>
                        </div>
                    ) : (
                    <>
                        <button type="button" onClick={() => handleConfirm('auto')}
                            className={`w-full py-3.5 font-black text-white rounded-xl transition-colors text-sm mb-3 ${status === 'LATE' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                            {status === 'LATE' ? 'DAR PRESENTE (TARDE) · AUTO-RELEVO' : 'DAR PRESENTE · AUTO-RELEVO FIFO'}
                        </button>
                        {mustRelevar && (
                            <div className="mb-3 px-3 py-2 bg-rose-50 border border-rose-200 rounded-xl">
                                <p className="text-xs font-bold text-rose-600">Puesto al tope ({activeGuards.length}/{positionCapacity}). Auto-relevo FIFO o forzá quién sale.</p>
                            </div>
                        )}
                        {activeGuards.length > 0 ? (
                            <div className="space-y-2 mb-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Forzar relevo (opcional):</p>
                                {activeGuards.map((s: any) => {
                                    const minutesWorked = s.totalMinutesWorked ?? 0;
                                    const hoursWorked = (minutesWorked / 60).toFixed(1);
                                    const isOver12h = minutesWorked >= 12 * 60;
                                    return (
                                        <button key={s.id} type="button" onClick={() => handleConfirm('override', s.id)}
                                            className={`w-full p-3 border rounded-xl flex justify-between items-center group ${s.isRetention ? 'border-orange-300 bg-orange-50/40 hover:bg-orange-50' : isOver12h ? 'border-red-200 bg-red-50/30 hover:bg-red-50/50' : 'border-slate-200 hover:bg-slate-50'}`}>
                                            <div className="flex items-center gap-2.5 text-left">
                                                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${s.isRetention ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>
                                                    {(s.employeeName || '?')[0]}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-xs font-bold text-slate-700">{s.employeeName}</span>
                                                        {s.isRetention && <span className="text-[9px] font-black px-1 py-0.5 rounded-full bg-orange-500 text-white">RETENIDO</span>}
                                                        {isOver12h && !s.isRetention && <span className="text-[9px] font-black px-1 py-0.5 rounded-full bg-red-100 text-red-700">+12h</span>}
                                                    </div>
                                                    <span className="text-[10px] text-slate-400">Salida: {fmt24h(s.endDateObj)} · {hoursWorked}h trabajadas</span>
                                                </div>
                                            </div>
                                            <span className="text-[10px] font-black bg-indigo-600 text-white px-3 py-1.5 rounded-lg group-hover:bg-indigo-700 transition-colors shrink-0">RELEVAR</span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center mb-3 space-y-1">
                                <p className="text-xs font-bold text-slate-600">No hay guardia saliente en el puesto</p>
                                <p className="text-[11px] text-slate-500 leading-snug">
                                    El auto-relevo no encontrará saliente; el entrante queda solo en el puesto.
                                </p>
                            </div>
                        )}
                        <button type="button" onClick={() => handleConfirm('skip')}
                            className="w-full py-2.5 font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors text-xs">
                            INGRESAR SIN RELEVAR
                        </button>
                    </>
                    )}
                </div>
            </div>
        </div>
    );
};

const normPosName = (n: unknown) => String(n ?? '').trim().toLowerCase();

const InterruptModal = ({ isOpen, onClose, shift, logic, onVacancyCreated }: any) => {
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = !!(empresa as any)?.migracionCompleta;
    if (!isOpen || !shift) return null;
    const colleagues = logic.processedData.filter((s:any) => s.objectiveId === shift.objectiveId && s.id !== shift.id && (s.isPresent || s.status === 'PRESENT') && !s.isCompleted);
    const isAlone = colleagues.length === 0;
    const handleLog = async () => {
        try {
            await updateDocForEmpresa('turnos', shift.id, { realEndTime: serverTimestamp(), status: 'COMPLETED', comments: 'Baja anticipada (Cubierto)' }, empresaId, migracionCompleta);
            const shiftEmpresaId = String(shift.empresaId || empresaId || '').trim();
            await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'BAJA_CUBIERTA', status: 'pending', shiftId: shift.id, clientId: shift.clientId || null, objectiveId: shift.objectiveId || null, description: 'Retiro anticipado. Puesto cubierto por dotación.', createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, shiftEmpresaId));
            // Bitácora
            {
                const _actor = getAuth().currentUser?.displayName || getAuth().currentUser?.email?.split('@')[0] || 'Operador';
                addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                    action: 'BAJA_CUBIERTA', module: 'OPERACIONES', actorName: _actor,
                    timestamp: serverTimestamp(), employeeId: shift.employeeId,
                    employeeName: shift.employeeName, objectiveId: shift.objectiveId,
                    objectiveName: shift.objectiveName, shiftId: shift.id,
                    details: `${shift.employeeName} – baja anticipada (puesto cubierto) en ${shift.objectiveName || ''}.`,
                }, String(shift.empresaId || empresaId || '').trim())).catch(() => {});
            }
            toast.success("Baja registrada. Puesto cubierto.");
            onClose();
        } catch (e: any) { toast.error('Error al registrar baja: ' + (e?.message || e?.code || String(e))); }
    };
    const handleProtocol = async () => {
        try {
            await updateDocForEmpresa('turnos', shift.id, { status: 'INTERRUPTED', realEndTime: serverTimestamp() }, empresaId, migracionCompleta);
            const endTs = shift.endDateObj ? Timestamp.fromDate(shift.endDateObj instanceof Date ? shift.endDateObj : new Date(shift.endDateObj)) : null;
            const shiftEmpresaId = String(shift.empresaId || empresaId || '').trim();
            const vacancyPayload: any = stampEmpresaId({
                clientId: shift.clientId, clientName: shift.clientName,
                objectiveId: shift.objectiveId, objectiveName: shift.objectiveName,
                positionName: shift.positionName,
                employeeId: 'VACANTE', employeeName: 'VACANTE (BAJA)',
                startTime: serverTimestamp(),
                status: 'UNCOVERED_REPORTED', isUnassigned: true, isPresent: false, isReported: true,
                origin: 'INTERRUPTION', originRef: shift.id, createdAt: serverTimestamp(),
            }, shiftEmpresaId);
            if (endTs) vacancyPayload.endTime = endTs;
            const newRef = await addDoc(collection(db, 'turnos'), vacancyPayload);
            onVacancyCreated({ ...vacancyPayload, id: newRef.id, isUnassigned: true });
            // Bitácora
            {
                const _actor = getAuth().currentUser?.displayName || getAuth().currentUser?.email?.split('@')[0] || 'Operador';
                addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                    action: 'BAJA_PROTOCOLO', module: 'OPERACIONES', actorName: _actor,
                    timestamp: serverTimestamp(), employeeId: shift.employeeId,
                    employeeName: shift.employeeName, objectiveId: shift.objectiveId,
                    objectiveName: shift.objectiveName, shiftId: shift.id,
                    details: `${shift.employeeName} – baja anticipada (protocolo vacante) en ${shift.objectiveName || ''}.`,
                }, String(shift.empresaId || empresaId || '').trim())).catch(() => {});
            }
        } catch (e: any) { toast.error('Error al iniciar protocolo: ' + (e?.message || e?.code || String(e))); }
    };
    return (
        <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
                {/* Header con avatar */}
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
                {/* Chips contextuales */}
                <div className="px-4 pt-3 pb-2 flex flex-wrap gap-1.5">
                    <span className="flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
                        <MapPin size={9}/> {shift.objectiveName || '—'}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                        <Shield size={9}/> {shift.positionName || '—'}
                    </span>
                </div>
                <div className="px-4 pb-5">
                    <div className={`p-3 rounded-xl border mb-4 ${isAlone ? 'bg-purple-50 border-purple-100' : 'bg-emerald-50 border-emerald-100'}`}>
                        <p className={`font-black text-sm mb-1 ${isAlone ? 'text-purple-800' : 'text-emerald-800'}`}>
                            {isAlone ? 'GUARDIA SOLO EN EL OBJETIVO' : `HAY ${colleagues.length} COMPAÑEROS`}
                        </p>
                        <p className="text-xs text-slate-500">
                            {isAlone ? 'El puesto quedará descubierto. Se requiere activar protocolo.' : 'El puesto puede ser cubierto por la dotación actual.'}
                        </p>
                    </div>
                    {isAlone ? (
                        <button onClick={handleProtocol}
                            className="w-full py-3.5 bg-purple-600 text-white font-black rounded-xl hover:bg-purple-700 transition-colors text-sm">
                            INICIAR PROTOCOLO DE COBERTURA
                        </button>
                    ) : (
                        <button onClick={handleLog}
                            className="w-full py-3.5 bg-emerald-600 text-white font-black rounded-xl hover:bg-emerald-700 transition-colors text-sm">
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

const CoverageRow = ({ item, lKey, onAction, label, color, loading, onWA }: any) => {
    const name = item.employeeName || item.fullName || '';
    const ph = item.phone || item.celular || '';
    const busy = loading === lKey;
    // Badge de experiencia
    const expLv: number = item.experienceLv ?? 0;
    const expBadge = expLv === 3
        ? <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">★ Titular</span>
        : expLv === 2
            ? <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">◆ Conoce el objetivo</span>
            : expLv === 1
                ? <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Mismo cliente</span>
                : null;
    return (
        <div className={`flex items-center justify-between p-2 bg-white border rounded-lg gap-2 shadow-sm ${expLv >= 2 ? 'border-emerald-200' : 'border-slate-100'}`}>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs font-bold text-slate-800 truncate">{name}</span>
                    {expBadge}
                </div>
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

const CoverageModal = ({ isOpen, onClose, absenceShift, logic }: any) => {
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = !!(empresa as any)?.migracionCompleta;
    const tenantId = (s?: any) => String(s?.empresaId || absenceShift?.empresaId || empresaId || '').trim();
    const [loading, setLoading] = useState<string | null>(null);
    const [localWa, setLocalWa] = useState<{ isOpen: boolean; ctx: WAComposeContext }>({ isOpen: false, ctx: { employeeName: '', phone: '' } });
    const [showNoCoverage, setShowNoCoverage] = useState(false);
    const [noCoverageNotes, setNoCoverageNotes] = useState('');
    const [noCoverageLoading, setNoCoverageLoading] = useState(false);

    if (!isOpen || !absenceShift) return null;
    if (absenceShift.isReportedToPlanning && absenceShift.isUnassigned) {
        toast.info('Vacante devuelta a planificación — no se puede cubrir desde operaciones.');
        onClose();
        return null;
    }

    const now = new Date();
    const absenceEnd = toDate(absenceShift.endDateObj);
    const hiStart = formatTimeSimple(absenceShift.shiftDateObj);
    const hiEnd = formatTimeSimple(absenceShift.endDateObj);
    const objLat = absenceShift.lat || -31.4201;
    const objLng = absenceShift.lng || -64.1888;

    // 1. RETENCIÓN: presentes en mismo objetivo y posición CUYO TURNO YA INICIÓ
    // Fix: excluir guardias con turno futuro — solo quien está físicamente en el puesto ahora
    const retencion = logic.processedData.filter((s: any) => {
        if (!s.isPresent || s.isCompleted) return false;
        if (s.objectiveId !== absenceShift.objectiveId) return false;
        if (s.positionName !== absenceShift.positionName) return false;
        if (s.id === absenceShift.id) return false;
        // Verificar que el turno ya empezó (no mostrar turnos futuros)
        const shiftStartMs = s.shiftDateObj ? toDate(s.shiftDateObj).getTime() : 0;
        return shiftStartMs > 0 && now.getTime() >= shiftStartMs;
    });

    // 2. ADELANTO: solo el turno siguiente más próximo en el mismo objetivo/posición — HOY únicamente
    const adelanto = logic.processedData.filter((s: any) =>
        !s.isPresent && !s.isCompleted && !s.isAbsent && !s.isUnassigned && !s.isFranco &&
        s.objectiveId === absenceShift.objectiveId &&
        s.positionName === absenceShift.positionName &&
        toDate(s.shiftDateObj) > now &&
        isSameDay(toDate(s.shiftDateObj), now)  // â† solo HOY, no mañana
    ).sort((a: any, b: any) => toDate(a.shiftDateObj).getTime() - toDate(b.shiftDateObj).getTime()).slice(0, 1);

    // Helper de experiencia: nivel usando experienciaObjetivos (mapa por objectiveId)
    const experienceLevel = (e: any): number => {
        const objId = absenceShift.objectiveId;
        // Nivel 3: objetivo preferido (titular del puesto)
        if (e.preferredObjectiveId === objId) return 3;
        // Nivel 2: tiene historial en este objetivo (CONOCIDO o ESCUELA)
        const expMap: Record<string, any> = e.experienciaObjetivos || {};
        const entry = expMap[objId];
        if (entry) {
            const turnosTotal = (entry.turnosRegulares ?? 0) + (entry.turnosRefuerzo ?? 0) + (entry.turnosConvocado ?? 0) + (entry.turnosEscuela ?? 0);
            if (turnosTotal > 0) return 2;
        }
        // Nivel 1: mismo cliente
        if (e.clientId === absenceShift.clientId) return 1;
        return 0;
    };

    // Helper de restricciones: igual que Planificación — no mostrar guardias vetados
    const isRestricted = (e: any): boolean => {
        if ((e.restriccionesObjetivo || []).some((r: any) => r.objectiveId === absenceShift.objectiveId)) return true;
        if ((e.restriccionesCliente  || []).some((r: any) => r.clientId    === absenceShift.clientId))   return true;
        return false;
    };

    // 3. RETENES: empleados sin turno hoy — sin restricciones, ordenados por experiencia, luego cercanía
    const busyIds = new Set(
        logic.processedData.filter((s: any) => isSameDay(s.shiftDateObj, now) && !s.isFranco).map((s: any) => s.employeeId)
    );
    const retenes = (logic.employees || [])
        .filter((e: any) => !busyIds.has(e.id) && !isRestricted(e)) // â† excluir restringidos
        .map((e: any) => {
            const dist  = calculateDistance(objLat, objLng, e.lat, e.lng);
            const expLv = experienceLevel(e);
            return {
                ...e,
                fullName:    e.firstName ? `${e.firstName} ${e.lastName || ''}`.trim() : e.name || e.fullName || '',
                phone:       e.phone || e.celular || '',
                distance:    dist,
                eta:         Number.isFinite(dist) ? estimateEta(dist) : null,
                experienceLv: expLv,    // 3=mismo obj, 2=obj asignado, 1=mismo cliente, 0=sin exp
            };
        })
        .sort((a: any, b: any) => {
            if (b.experienceLv !== a.experienceLv) return b.experienceLv - a.experienceLv; // exp desc
            return (a.distance ?? Infinity) - (b.distance ?? Infinity);                    // dist asc
        })
        .slice(0, 12);

    // 4. FRANCOS: turnos franco hoy, no trabajados — sin restricciones, mismo orden
    const francos = logic.processedData
        .filter((s: any) => {
            if (!s.isFranco || !isSameDay(s.shiftDateObj, now) || s.isFrancoTrabajado) return false;
            const emp = (logic.employees || []).find((e: any) => e.id === s.employeeId);
            if (emp && isRestricted(emp)) return false; // â† excluir restringidos
            return true;
        })
        .map((s: any) => {
            const emp   = (logic.employees || []).find((e: any) => e.id === s.employeeId);
            const dist  = calculateDistance(objLat, objLng, emp?.lat, emp?.lng);
            const expLv = emp ? experienceLevel(emp) : 0;
            return { ...s, fullName: s.employeeName, phone: s.phone || emp?.phone || emp?.celular || '', distance: dist, eta: Number.isFinite(dist) ? estimateEta(dist) : null, experienceLv: expLv };
        })
        .sort((a: any, b: any) => {
            if (b.experienceLv !== a.experienceLv) return b.experienceLv - a.experienceLv;
            return (a.distance ?? Infinity) - (b.distance ?? Infinity);
        })
        .slice(0, 12);

    const openLocalWA = (item: any) => {
        const nombre = item.employeeName || item.fullName || '';
        const ph = item.phone || item.celular || '';
        setLocalWa({ isOpen: true, ctx: { employeeName: nombre, phone: ph, objectiveName: absenceShift.objectiveName, horaInicio: hiStart, horaFin: hiEnd } });
    };

    const isRealVacantShift = absenceShift.isUnassigned && absenceShift.id && !absenceShift.isVirtual && !String(absenceShift.id).startsWith('V124_') && !String(absenceShift.id).startsWith('SLA_GAP');

    const markCoverageResolved = (batch: ReturnType<typeof writeBatch>, coverageType: string, coveringEmployee?: any) => {
        if (!absenceShift?.id || absenceShift.isVirtual || String(absenceShift.id).startsWith('V124_') || String(absenceShift.id).startsWith('SLA_GAP')) return;
        if (absenceShift.isUnassigned || absenceShift.isAbsent || absenceShift.isPotentialAbsence) {
            const covEmpId   = coveringEmployee?.id || coveringEmployee?.employeeId || null;
            const covEmpName = coveringEmployee?.fullName || coveringEmployee?.employeeName || coveringEmployee?.name || null;
            const isAbsence  = absenceShift.isAbsent || absenceShift.isPotentialAbsence;
            batch.update(doc(db, 'turnos', absenceShift.id), {
                // Para vacantes: status=COVERED (se oculta de operaciones)
                // Para ausencias: mantener isAbsent=true, solo agregar info de cobertura (sigue en RRHH)
                ...(isAbsence ? {} : { status: 'COVERED' }),
                resolvedBy:            'OPERACIONES',
                coverageType,                           // RETENTION | EARLY_START | RETEN | FRANCO
                coveredAt:             serverTimestamp(),
                coveredByEmployeeId:   covEmpId,        // quién cubrió
                coveredByEmployeeName: covEmpName,      // nombre para mostrar en planificación
                operacionallyCovered:  true,            // slot operativo cubierto
            });
        }
    };

    const handleRetener = async (s: any) => {
        setLoading('ret_' + s.id);
        try {
            const batch = writeBatch(db);
            batch.update(doc(db, 'turnos', s.id), { isRetention: true, retentionEndTime: Timestamp.fromDate(absenceEnd) });
            batch.set(doc(collection(db, 'user_notifications')), stampEmpresaId({ userId: s.employeeId, type: 'RETENCION', title: 'Quedaste retenido', read: false, body: `Tu turno en ${absenceShift.objectiveName} se extiende hasta ${hiEnd}.`, objectiveId: absenceShift.objectiveId, shiftId: s.id, createdAt: serverTimestamp() }, tenantId(s)));
            markCoverageResolved(batch, 'RETENTION', s);
            await batch.commit();
            await Promise.race([
                waitForPendingWrites(db),
                new Promise<void>((_, reject) => setTimeout(() => reject(new Error('sync_timeout')), 8000)),
            ]).catch(err => {
                if ((err as Error).message === 'sync_timeout') {
                    toast.warning('âš ï¸ Conexión lenta — verificá que el presente quedó guardado antes de cerrar.');
                }
            });
            await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'RETENCION', title: 'Retención de guardia', status: 'pending', employeeId: s.employeeId, employeeName: s.employeeName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: s.id, absenceShiftId: absenceShift.id, description: `${s.employeeName} retenido hasta ${hiEnd} por ausencia de ${absenceShift.employeeName || ''}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tenantId(s)));
            addDoc(collection(db, 'audit_logs'), stampEmpresaId({ action: 'RETENCION', module: 'OPERACIONES', actorName: getAuth().currentUser?.email?.split('@')[0] || 'Operador', timestamp: serverTimestamp(), employeeId: s.employeeId, employeeName: s.employeeName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: s.id, details: `${s.employeeName} retenido hasta ${hiEnd} en ${absenceShift.objectiveName || ''}.` }, tenantId(s))).catch(() => {});
            toast.success(`${s.employeeName} retenido hasta ${hiEnd}`);
            onClose();
        } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
        finally { setLoading(null); }
    };

    const handleAdelantar = async (s: any) => {
        setLoading('adel_' + s.id);
        try {
            const batch = writeBatch(db);
            // adjustedStartTime = inicio del turno a cubrir (no la hora actual)
            // El guardia cobra desde el inicio de la vacante aunque llegue tarde
            const vacancyStart = absenceShift.shiftDateObj instanceof Date
                ? Timestamp.fromDate(absenceShift.shiftDateObj)
                : Timestamp.fromDate(toDate(absenceShift.shiftDateObj));
            batch.update(doc(db, 'turnos', s.id), { adjustedStartTime: vacancyStart, isEarlyStart: true });
            batch.set(doc(collection(db, 'user_notifications')), stampEmpresaId({ userId: s.employeeId, type: 'ADELANTO', title: 'Turno adelantado', read: false, body: `Tu turno en ${absenceShift.objectiveName} fue adelantado. Confirmá llegada.`, objectiveId: absenceShift.objectiveId, shiftId: s.id, createdAt: serverTimestamp() }, tenantId(s)));
            markCoverageResolved(batch, 'EARLY_START', s);
            await batch.commit();
            await Promise.race([
                waitForPendingWrites(db),
                new Promise<void>((_, reject) => setTimeout(() => reject(new Error('sync_timeout')), 8000)),
            ]).catch(err => {
                if ((err as Error).message === 'sync_timeout') {
                    toast.warning('âš ï¸ Conexión lenta — verificá que el presente quedó guardado antes de cerrar.');
                }
            });
            await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'ADELANTO_TURNO', title: 'Adelanto de turno', status: 'pending', employeeId: s.employeeId, employeeName: s.employeeName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: s.id, description: `Turno de ${s.employeeName} adelantado desde ${formatTimeSimple(s.shiftDateObj)}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tenantId(s)));
            addDoc(collection(db, 'audit_logs'), stampEmpresaId({ action: 'ADELANTO_TURNO', module: 'OPERACIONES', actorName: getAuth().currentUser?.email?.split('@')[0] || 'Operador', timestamp: serverTimestamp(), employeeId: s.employeeId, employeeName: s.employeeName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: s.id, details: `Turno de ${s.employeeName} adelantado en ${absenceShift.objectiveName || ''}.` }, tenantId(s))).catch(() => {});
            toast.success(`Turno de ${s.employeeName} adelantado`);
            onClose();
        } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
        finally { setLoading(null); }
    };

    const handleReten = async (emp: any) => {
        setLoading('reten_' + emp.id);
        try {
            // RETEN empieza AHORA (no en el pasado) — evita que detectarAusencias lo marque AA
            const slotStart = new Date(); // ahora
            // endTime = fin real del turno a cubrir (NO 8h fijos — respetar SLA)
            const endTime = absenceEnd;
            const empName = emp.fullName || emp.name || '';
            const newRef = doc(collection(db, 'turnos'));
            const batch = writeBatch(db);
            batch.set(newRef, stampEmpresaId({ employeeId: emp.id, employeeName: empName, clientId: absenceShift.clientId, clientName: absenceShift.clientName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, positionName: absenceShift.positionName, startTime: Timestamp.fromDate(slotStart), endTime: Timestamp.fromDate(endTime), status: 'PENDING', origin: 'RETEN', isReten: true, absenceShiftId: absenceShift.id, createdAt: serverTimestamp() }, tenantId(absenceShift)));
            batch.set(doc(collection(db, 'user_notifications')), stampEmpresaId({ userId: emp.id, type: 'RETEN', title: 'Convocatoria de Retén', read: false, body: `Sos convocado como retén en ${absenceShift.objectiveName} (${absenceShift.positionName}).`, objectiveId: absenceShift.objectiveId, shiftId: newRef.id, createdAt: serverTimestamp() }, tenantId(absenceShift)));
            markCoverageResolved(batch, 'RETEN', { id: emp.id, fullName: empName });
            await batch.commit();
            await Promise.race([
                waitForPendingWrites(db),
                new Promise<void>((_, reject) => setTimeout(() => reject(new Error('sync_timeout')), 8000)),
            ]).catch(err => {
                if ((err as Error).message === 'sync_timeout') {
                    toast.warning('âš ï¸ Conexión lenta — verificá que el presente quedó guardado antes de cerrar.');
                }
            });
            await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'CONVOCATORIA_RETEN', title: 'Convocatoria retén', status: 'pending', employeeId: emp.id, employeeName: empName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: newRef.id, description: `${empName} convocado como retén en ${absenceShift.objectiveName}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tenantId(absenceShift)));
            addDoc(collection(db, 'audit_logs'), stampEmpresaId({ action: 'CONVOCATORIA_RETEN', module: 'OPERACIONES', actorName: getAuth().currentUser?.email?.split('@')[0] || 'Operador', timestamp: serverTimestamp(), employeeId: emp.id, employeeName: empName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: newRef.id, details: `${empName} convocado como retén en ${absenceShift.objectiveName || ''}.` }, tenantId(absenceShift))).catch(() => {});
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
            batch.set(doc(collection(db, 'user_notifications')), stampEmpresaId({ userId: s.employeeId, type: 'FRANCO_TRABAJADO', title: 'Franco trabajado', read: false, body: `Se te convoca a trabajar tu franco en ${absenceShift.objectiveName}.`, objectiveId: absenceShift.objectiveId, shiftId: s.id, createdAt: serverTimestamp() }, tenantId(s)));
            markCoverageResolved(batch, 'FRANCO', s);
            await batch.commit();
            await Promise.race([
                waitForPendingWrites(db),
                new Promise<void>((_, reject) => setTimeout(() => reject(new Error('sync_timeout')), 8000)),
            ]).catch(err => {
                if ((err as Error).message === 'sync_timeout') {
                    toast.warning('âš ï¸ Conexión lenta — verificá que el presente quedó guardado antes de cerrar.');
                }
            });
            await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'FRANCO_TRABAJADO', title: 'Franco trabajado', status: 'pending', employeeId: s.employeeId, employeeName: s.employeeName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: s.id, description: `${s.employeeName} trabaja su franco en ${absenceShift.objectiveName}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tenantId(s)));
            addDoc(collection(db, 'audit_logs'), stampEmpresaId({ action: 'FRANCO_TRABAJADO', module: 'OPERACIONES', actorName: getAuth().currentUser?.email?.split('@')[0] || 'Operador', timestamp: serverTimestamp(), employeeId: s.employeeId, employeeName: s.employeeName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: s.id, details: `${s.employeeName} convocado (Franco Trabajado) en ${absenceShift.objectiveName || ''}.` }, tenantId(s))).catch(() => {});
            toast.success(`${s.employeeName} convocado (Franco Trabajado)`);
            onClose();
        } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
        finally { setLoading(null); }
    };

    return (
        <>
            <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in">
                <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                    {/* Header con avatar del ausente */}
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
                    {/* Chip posición */}
                    <div className="px-4 py-2 flex flex-wrap gap-1.5 bg-rose-50 border-b border-rose-100 shrink-0">
                        <span className="flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-white border border-rose-200 px-2.5 py-1 rounded-full">
                            <Shield size={9}/> {absenceShift.positionName || '—'}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-rose-600 bg-white border border-rose-200 px-2.5 py-1 rounded-full">
                            {hiStart}–{hiEnd}
                        </span>
                    </div>
                    <div className="p-4 overflow-y-auto custom-scrollbar space-y-5 flex-1">
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
                        {/* Sin Cobertura — última medida */}
                        <div className="border-t border-slate-200 pt-4">
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
                                                    type: 'SIN_COBERTURA', title: 'Puesto sin cobertura',
                                                    status: 'pending',
                                                    objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName || '',
                                                    positionName: absenceShift.positionName || '',
                                                    employeeId: absenceShift.employeeId || null,
                                                    employeeName: absenceShift.employeeName || null,
                                                    clientId: absenceShift.clientId || null,
                                                    shiftId: absenceShift.id || null,
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
            <WAComposeModal isOpen={localWa.isOpen} onClose={() => setLocalWa(d => ({...d, isOpen: false}))} ctx={localWa.ctx}/>
        </>
    );
};

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
                            <span className="bg-orange-700/60 text-orange-100 text-[10px] px-2 py-0.5 rounded font-mono">{formatTimeRange(retainedShift.shiftDateObj, retainedShift.endDateObj)}</span>
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
    const [novedad, setNovedad] = useState('');
    const [showNovedad, setShowNovedad] = useState(false);
    if (!isOpen) return null;
    const initials = (employeeName || '?').split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0]).join('').toUpperCase();
    return (
        <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
                <div className="p-4 bg-purple-700 flex justify-between items-start">
                    <div>
                        <p className="text-purple-200 text-[10px] font-bold uppercase tracking-widest mb-0.5">Salida del guardia</p>
                        <p className="text-white font-bold text-base leading-tight">{shift?.objectiveName || 'Turno'}</p>
                        {shift && (
                            <div className="flex gap-1.5 mt-1.5 flex-wrap">
                                {shift.positionName && <span className="bg-purple-900/50 text-purple-100 text-[10px] px-2 py-0.5 rounded">{shift.positionName}</span>}
                                <span className="bg-purple-900/50 text-purple-100 text-[10px] px-2 py-0.5 rounded font-mono">{formatTimeRange(shift.shiftDateObj, shift.endDateObj)}</span>
                            </div>
                        )}
                    </div>
                    <button onClick={onClose} className="bg-white/20 p-1.5 rounded-lg hover:bg-white/30 shrink-0"><X size={16} className="text-white"/></button>
                </div>
                <div className="p-5">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                            <span className="text-purple-700 font-bold text-base">{initials}</span>
                        </div>
                        <div>
                            <p className="font-bold text-slate-900 text-sm">{employeeName}</p>
                            <p className="text-xs text-slate-500 mt-0.5">Registrar salida del turno</p>
                        </div>
                    </div>
                    <button onClick={() => { onConfirm(false); onClose(); }} className="w-full py-3 bg-purple-700 text-white font-bold rounded-xl hover:bg-purple-800 transition-colors text-sm mb-3">CONFIRMAR SALIDA</button>
                    <button onClick={() => setShowNovedad(v => !v)} className="w-full py-2 text-xs text-slate-500 hover:text-slate-700 border border-dashed border-slate-200 rounded-xl transition-colors mb-2">
                        {showNovedad ? '▲ Ocultar novedad' : '+ Reportar novedad al salir'}
                    </button>
                    {showNovedad && (
                        <>
                            <textarea className="w-full p-3 border border-slate-200 rounded-xl text-sm mb-2 resize-none focus:outline-none focus:border-purple-400" rows={3} placeholder="Describí la novedad..." value={novedad} onChange={e=>setNovedad(e.target.value)}/>
                            <button onClick={() => { onConfirm(novedad); setNovedad(''); onClose(); }} disabled={!novedad.trim()} className="w-full py-2.5 bg-slate-700 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors text-sm disabled:opacity-40 mb-2">REPORTAR Y SALIR</button>
                        </>
                    )}
                    <button onClick={onClose} className="w-full py-2 text-xs text-slate-400 hover:text-slate-600 transition-colors">Cancelar</button>
                </div>
            </div>
        </div>
    );
};
const AttendanceModal = ({ isOpen, onClose, shift, onMarkAbsent }: any) => {
    if (!isOpen || !shift) return null;
    const initials = (shift.employeeName || '?').split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0]).join('').toUpperCase();
    return (
        <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
                <div className="p-4 bg-rose-600 flex justify-between items-start">
                    <div>
                        <p className="text-rose-200 text-[10px] font-bold uppercase tracking-widest mb-0.5">Confirmar ausencia</p>
                        <p className="text-white font-bold text-base leading-tight">{shift.objectiveName || '—'}</p>
                        <div className="flex gap-1.5 mt-1.5 flex-wrap">
                            {shift.positionName && <span className="bg-rose-700/60 text-rose-100 text-[10px] px-2 py-0.5 rounded">{shift.positionName}</span>}
                            <span className="bg-rose-700/60 text-rose-100 text-[10px] px-2 py-0.5 rounded font-mono">{formatTimeRange(shift.shiftDateObj, shift.endDateObj)}</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="bg-white/20 p-1.5 rounded-lg hover:bg-white/30 shrink-0"><X size={16} className="text-white"/></button>
                </div>
                <div className="p-5">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                            <span className="text-rose-700 font-bold text-base">{initials}</span>
                        </div>
                        <div>
                            <p className="font-bold text-slate-900 text-sm">{shift.employeeName}</p>
                            <p className="text-xs text-slate-500 mt-0.5">No se presentó al turno</p>
                        </div>
                    </div>
                    <button onClick={() => onMarkAbsent(shift)} className="w-full py-3 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 transition-colors text-sm mb-2">MARCAR AUSENTE</button>
                    <button onClick={onClose} className="w-full py-2 text-xs text-slate-400 hover:text-slate-600 transition-colors">Cancelar</button>
                </div>
            </div>
        </div>
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

const WorkedDayOffModal = ({ isOpen, onClose, shift }: any) => {
    if (!isOpen || !shift) return null;
    const initials = (shift.employeeName || '?').split(' ').filter(Boolean).slice(0,2).map((w:string)=>w[0]).join('').toUpperCase();
    return (
        <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
                <div className="p-4 bg-blue-600 flex justify-between items-start">
                    <div>
                        <p className="text-blue-200 text-[10px] font-bold uppercase tracking-widest mb-0.5">Franco trabajado</p>
                        <p className="text-white font-bold text-base leading-tight">{shift.objectiveName || '—'}</p>
                        <div className="flex gap-1.5 mt-1.5 flex-wrap">
                            {shift.positionName && <span className="bg-blue-700/60 text-blue-100 text-[10px] px-2 py-0.5 rounded">{shift.positionName}</span>}
                            <span className="bg-blue-700/60 text-blue-100 text-[10px] px-2 py-0.5 rounded font-mono">{formatTimeRange(shift.shiftDateObj, shift.endDateObj)}</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="bg-white/20 p-1.5 rounded-lg hover:bg-white/30 shrink-0"><X size={16} className="text-white"/></button>
                </div>
                <div className="p-5">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                            <span className="text-blue-700 font-bold text-base">{initials}</span>
                        </div>
                        <div>
                            <p className="font-bold text-slate-900 text-sm">{shift.employeeName}</p>
                            <p className="text-xs text-blue-600 font-semibold mt-0.5">Convocado — franco trabajado</p>
                        </div>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 text-xs text-blue-800">
                        El guardia fue convocado a trabajar su día de franco. El turno queda registrado como Franco Trabajado (FT).
                    </div>
                    <button onClick={onClose} className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-colors text-sm">Cerrar</button>
                </div>
            </div>
        </div>
    );
};

// â"€â"€ Popup de detalle de novedad â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const TYPE_META: Record<string, { label: string; bg: string; text: string; border: string }> = {
    AUSENCIA_AUTO:                { label: 'AUSENCIA AUTO',   bg: 'bg-rose-600',   text: 'text-white',     border: 'border-rose-500' },
    AUSENCIA_CORTO_PLAZO:         { label: 'URGENTE',         bg: 'bg-red-600',    text: 'text-white',     border: 'border-red-500' },
    AVISO_AUSENCIA_ANTICIPADA:    { label: 'ANTICIPADA',      bg: 'bg-amber-500',  text: 'text-white',     border: 'border-amber-400' },
    VACANTE_PROTOCOLO_COBERTURA:  { label: 'PROTOCOLO',       bg: 'bg-orange-500', text: 'text-white',     border: 'border-orange-400' },
    RELEVO_NO_PRESENTADO:         { label: 'SIN RELEVO',      bg: 'bg-amber-600',  text: 'text-white',     border: 'border-amber-500' },
    POSICION_SIN_RELEVO:          { label: 'SIN RELEVO',      bg: 'bg-amber-600',  text: 'text-white',     border: 'border-amber-500' },
    RETENCION_LARGA:              { label: 'RETENCIÓN',       bg: 'bg-orange-700', text: 'text-white',     border: 'border-orange-600' },
    RELEVO_INMINENTE:             { label: 'RELEVO',          bg: 'bg-blue-600',   text: 'text-white',     border: 'border-blue-500' },
    CONVOCATORIA_RETEN:           { label: 'CONVOCATORIA',    bg: 'bg-indigo-600', text: 'text-white',     border: 'border-indigo-500' },
    FRANCO_TRABAJADO:             { label: 'FRANCO TRAB.',    bg: 'bg-indigo-600', text: 'text-white',     border: 'border-indigo-500' },
    ADELANTO_TURNO:               { label: 'ADELANTO',        bg: 'bg-indigo-500', text: 'text-white',     border: 'border-indigo-400' },
    RRHH_NOVEDAD:                 { label: 'RRHH',            bg: 'bg-purple-600', text: 'text-white',     border: 'border-purple-500' },
    REFUERZO_CLIENTE_PENDIENTE:   { label: 'REFUERZO CLIENTE', bg: 'bg-violet-600', text: 'text-white',   border: 'border-violet-500' },
    VACANTE_OPERATIVA:            { label: 'VACANTE RFZ/TURA', bg: 'bg-fuchsia-600', text: 'text-white', border: 'border-fuchsia-500' },
    TURA_EXTENSION:               { label: 'TURA EXT', bg: 'bg-violet-600', text: 'text-white', border: 'border-violet-500' },
};
const DEFAULT_META = { label: 'NOVEDAD', bg: 'bg-slate-700', text: 'text-white', border: 'border-slate-500' };

const AUTO_CLOSE_MS = 3000;

const NovedadDetailPopup = ({ novedad, onClose, onAtender }: { novedad: any; onClose: () => void; onAtender: (n: any) => void }) => {
    const [remaining, setRemaining] = React.useState(AUTO_CLOSE_MS);
    const intervalRef = React.useRef<any>(null);
    const meta = TYPE_META[novedad?.type] ?? DEFAULT_META;

    React.useEffect(() => {
        if (!novedad) return;
        setRemaining(AUTO_CLOSE_MS);
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
    const pct = (remaining / AUTO_CLOSE_MS) * 100;

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
             style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)' }}
             onClick={onClose}>
            <div
                className={`w-full max-w-sm rounded-2xl shadow-2xl border-2 ${meta.border} overflow-hidden`}
                style={{ background: '#0f172a' }}
                onClick={e => e.stopPropagation()}
                onMouseEnter={pause}
                onMouseLeave={resume}
            >
                {/* Barra de progreso auto-cierre */}
                <div className="h-1 w-full bg-white/10">
                    <div
                        className={`h-full ${meta.bg} transition-none`}
                        style={{ width: `${pct}%`, transition: 'width 50ms linear' }}
                    />
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
                    {/* Empleado */}
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

                    {/* Objetivo */}
                    {novedad.objectiveName && (
                        <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                            <MapPin size={13} className="text-white/40 shrink-0"/>
                            <span className="text-white/90 text-xs font-bold">{novedad.objectiveName}</span>
                        </div>
                    )}

                    {/* Refuerzo / vacante cliente */}
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

                    {/* Descripción completa */}
                    {novedad.description && (
                        <p className="text-white/70 text-xs leading-relaxed border-l-2 border-white/20 pl-3">
                            {novedad.description}
                        </p>
                    )}

                    {/* Tiempo al turno */}
                    {novedad.minutesBeforeShift != null && novedad.minutesBeforeShift > 0 && (
                        <div className="flex items-center gap-1.5 text-amber-400">
                            <Clock size={12}/>
                            <span className="text-xs font-bold">{novedad.minutesBeforeShift} min al inicio del turno</span>
                        </div>
                    )}
                </div>

                {/* Footer: acción + auto-cierre */}
                <div className="px-4 pb-4 flex items-center justify-between gap-3">
                    <span className="text-white/30 text-[10px]">
                        Cerrando en {Math.ceil(remaining / 1000)}s · hover para pausar
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
                // El turno pasa de "en retención" a "extendido oficialmente" — limpiar flag
                updates.isRetention = false;
                updates.retentionReason = null;
            } else {
                updates.manualRetentionType = 'open';
                updates.retentionType = 'open';
                if (max12h) updates.retentionUntil = Timestamp.fromDate(max12h);
            }
            await updateDoc(doc(db, 'turnos', shift.id), updates);
            // Auto-desestimar novedades RETENCION_DETECTADA activas del turno
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
        } catch (e: any) { toast.error('Error al aplicar retención: ' + e.message); }
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

/** Solo turnos realmente de evento (EV). No alcanza con eventoId suelto en un M/T/N. */
const isEventShift = (shift: any): boolean => {
    const code = String(shift?.code || '').trim().toUpperCase();
    const origin = String(shift?.origin || '').trim().toUpperCase();
    return code === 'EV' || origin === 'EVENTO';
};

const getEventGroupKey = (shift: any): string => {
    const eventoId = String(shift?.eventoId || '').trim();
    const servicioId = String(shift?.servicioId || '').trim();
    if (eventoId || servicioId) return `EV_${eventoId || 'sin_evento'}_${servicioId || 'sin_servicio'}`;
    const eventoNombre = String(shift?.eventoNombre || '').trim();
    const servicioNombre = String(shift?.servicioNombre || '').trim();
    return `EVNAME_${eventoNombre || 'evento'}_${servicioNombre || 'servicio'}`;
};

const getEventGroupLabel = (shift: any): string => {
    const evento = String(shift?.eventoNombre || '').trim() || 'Evento sin nombre';
    const servicio = String(shift?.servicioNombre || '').trim();
    if (servicio) return `Evento: ${evento} · ${servicio}`;
    return `Evento: ${evento}`;
};

/** En EV mostrar el servicio del evento, no el puesto SLA que quedó pegado al convertir. */
const shiftPostLabel = (shift: any): string => {
    if (isEventShift(shift)) {
        return String(shift?.servicioNombre || shift?.eventoNombre || shift?.positionName || 'Evento').trim();
    }
    return String(shift?.positionName || '—').trim();
};

const GuardCard = ({ shift, viewTab, onOpenCheckout, onOpenAttendance, onOpenHandover, onOpenInterrupt, onOpenCoverage, onReportPlanning, onOpenWorkedFranco, onNovedadAbsence, onOpenWA, onOpenAbsenceDecision, onOpenRRHH, onOpenManualRetention, isCompact, isAutoMode, onRevertAbsence }: any) => {
    let accentColor = 'bg-slate-400'; let rowBg = 'bg-white';

    if (shift.isReportedToPlanning)   { accentColor = 'bg-slate-500';   rowBg = 'bg-slate-50'; }
    else if (shift.isResolvedByOps)   { accentColor = 'bg-indigo-500';  rowBg = 'bg-indigo-50/40'; }
    else if (shift.isUnassigned)       { accentColor = 'bg-rose-500';    rowBg = 'bg-rose-50/40'; }
    else if (shift.isRetention)        { accentColor = 'bg-orange-500';  rowBg = 'bg-orange-50/40'; }
    else if (shift.isPresent)          { accentColor = 'bg-emerald-500'; rowBg = 'bg-emerald-50/20'; }
    else if (shift.isAbsent)           { accentColor = 'bg-slate-700';   rowBg = 'bg-slate-100'; }
    else if (shift.isPotentialAbsence) { accentColor = 'bg-red-600';     rowBg = 'bg-red-50/40'; }
    else if (shift.isLateNotified)     { accentColor = 'bg-amber-500';   rowBg = 'bg-amber-50/60'; }
    else if (shift.isLateUnnotified)   { accentColor = 'bg-amber-400';   rowBg = 'bg-amber-50/30'; }
    else if (shift.isFranco)           { accentColor = 'bg-blue-500';    rowBg = 'bg-blue-50/20'; }

    const now = new Date();
    const start = toDate(shift.shiftDateObj);
    const diff = (now.getTime() - start.getTime()) / 60000;
    const canCheckIn = !shift.isPresent && (
        shift.isEarlyStart ||
        shift.isAwaitingCoverageCheckIn ||
        shift.origin === 'RETEN' ||
        !!shift.isReten ||
        (diff >= -15 && diff <= 120)
    );
    const handleReport = (e: any) => { e.stopPropagation(); if(confirm(`¿CONFIRMAR NOTIFICACIÓN?\nSe enviará alerta a Planificación.`)) onReportPlanning(shift); };
    const elapsedInShift = useElapsedTime(shift.activeStartTime || null);
    const canCover = !!(shift.isOperationalVacancy ?? (shift.isUnassigned && !shift.isReportedToPlanning));
    // Devolver a planificación: solo vacantes NO originadas por ausencia, dentro de las 12h previas al inicio
    const hoursUntilStart = shift.shiftDateObj ? (toDate(shift.shiftDateObj).getTime() - now.getTime()) / 3600000 : Infinity;
    const canReturn = canCover && shift.vacancyOrigin !== 'ABSENCE' && hoursUntilStart <= 12;

    let name = shift.isUnassigned ? (shift.employeeName || 'VACANTE') : (shift.employeeName || 'Desconocido');
    if (shift.isReportedToPlanning) name = name.replace('VACANTE: ', '');
    const refuerzoLabel = getRefuerzoLabel(shift);
    const avatarLabel = getGuardAvatarLabel(shift, name);
    const avatarClass = getGuardAvatarClass(shift);

    // Badge de estado
    let badge = null;
    if (shift.isReportedToPlanning)  badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-600 text-white flex items-center gap-0.5 shrink-0"><CornerUpLeft size={8}/> DEVUELTO</span>;
    else if (shift.isTuraCutSegment) badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-violet-700 text-white shrink-0">TURA 2º tramo</span>;
    else if (refuerzoLabel && shift.isUnassigned) badge = <span className={`text-[9px] font-black px-1.5 py-0.5 rounded text-white shrink-0 bg-fuchsia-600`}>{`VACANTE ${refuerzoLabel}`}</span>;
    else if (refuerzoLabel) badge = <span className={`text-[9px] font-black px-1.5 py-0.5 rounded text-white shrink-0 ${refuerzoLabel === 'TURA' ? 'bg-violet-600' : 'bg-red-600'}`}>{refuerzoLabel}</span>;
    else if (shift.turaContiguous) badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-violet-600 text-white shrink-0" title={shift.turaExtensionRange ? `Bloque ${shift.turaExtensionRange}` : 'TURA seguido'}>TURA seguido</span>;
    else if (shift.isUnassigned && shift.isPartialPlannedCoverage) badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-600 text-white shrink-0">PARCIAL PLAN</span>;
    else if (shift.isUnassigned) {
        const vOrigin = String(shift.origin || shift.vacancyOrigin || '');
        if (vOrigin === 'VACANTE_CORRECCION')   badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-700 text-white shrink-0">CORRECCIÓN PLAN</span>;
        else if (vOrigin === 'VACANTE_POR_EVENTO') badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-purple-600 text-white shrink-0">POR EVENTO</span>;
        else if (vOrigin === 'VACANTE_POR_AUSENCIA' || vOrigin === 'ABSENCE') badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-700 text-white shrink-0">POR AUSENCIA</span>;
        else if (vOrigin === 'RRHH_NOVEDAD')    badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-600 text-white shrink-0">NOVEDAD RRHH</span>;
        else if (vOrigin === 'NO_PLANNING' || vOrigin === 'SIN_PLANIFICAR') badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500 text-white shrink-0">SIN PLANIFICAR</span>;
        else badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-600 text-white shrink-0">SIN CUBRIR</span>;
    }
    else if (shift.isPendingRetention) badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-yellow-600 text-white shrink-0 flex items-center gap-0.5"><Clock size={8}/>ATENCIÓN: relevo pendiente</span>;
    else if (shift.manualRetentionType === 'extended')  badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-600 text-white shrink-0 flex items-center gap-0.5"><Timer size={8}/>+{shift.manualRetentionHours}h MANUAL</span>;
    else if (shift.manualRetentionType === 'open')      badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-600 text-white animate-pulse shrink-0 flex items-center gap-0.5"><Timer size={8}/>MANUAL INDEF</span>;
    else if (shift.isRetention)      badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-orange-500 text-white animate-pulse shrink-0 flex items-center gap-0.5"><Clock size={8}/>RECARGO AUTO {shift.retentionMinutes > 0 ? `+${shift.retentionMinutes}min` : ''}</span>;
    else if (shift.isPotentialAbsence) badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-red-600 text-white animate-pulse shrink-0">AUSENCIA</span>;
    else if (shift.isLateNotified)   badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500 text-white animate-pulse shrink-0 flex items-center gap-0.5">â± LLEGÓ TARDE {shift.minutesRemainingLate != null ? `· ${shift.minutesRemainingLate}min` : ''}</span>;
    else if (shift.isLateUnnotified) badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-400 text-white shrink-0">TARDE</span>;
    else if (shift.isPresent)        badge =<span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-600 text-white shrink-0 flex items-center gap-0.5"><Clock size={8}/>ACTIVO {elapsedInShift ? elapsedInShift : ''}</span>;
    else if (shift.isEarlyStart || shift.isAwaitingCoverageCheckIn) badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-indigo-600 text-white animate-pulse shrink-0 flex items-center gap-0.5"><PlayCircle size={8}/>{shift.coverageSegmentRole === 'EARLY_START' ? 'ADEL PLAN' : shift.isEarlyStart ? 'ADELANTADO' : 'CONVOCADO'}</span>;
    else if (shift.isPlannedExtensionImminent) badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-violet-600 text-white animate-pulse shrink-0 flex items-center gap-0.5"><Timer size={8}/>EXT PLAN</span>;
    else if (shift.isPlannedLiberationRet) badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-600 text-white shrink-0 flex items-center gap-0.5"><PlayCircle size={8}/>RET CONVOCABLE</span>;
    else if (shift.isConvocado && shift.isFuture) badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 shrink-0 flex items-center gap-0.5"><PlayCircle size={8}/>CONVOCADO</span>;
    else if (shift.isAbsent)         badge = shift.operacionallyCovered || shift.plannedOperativelyCovered
        ? <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-700 text-white shrink-0 flex items-center gap-0.5">AUSENTE <span className="bg-emerald-500 px-1 rounded text-[8px]">✓ cubierto</span></span>
        : <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-700 text-white shrink-0">AUSENTE</span>;
    else if (shift.isResolvedByOps)  badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-indigo-600 text-white shrink-0">OPS</span>;

    if (isCompact) return (
        <div className={`relative flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200/80 mb-1 shadow-sm hover:shadow-md transition-all ${rowBg}`}>
            <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${accentColor}`}/>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-black shrink-0 ml-1 ${avatarClass} ${refuerzoLabel ? 'text-[8px] tracking-tight' : 'text-[10px]'}`}>
                {avatarLabel}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 leading-tight">
                    <span className={`text-[11px] font-black truncate ${shift.isUnassigned && !shift.isReportedToPlanning ? 'text-rose-600' : 'text-slate-800'}`}>{name}</span>
                    {badge}
                </div>
                <div className="flex items-center gap-1.5 text-[9px] text-slate-400 leading-tight mt-0.5">
                    <span className="truncate">{shift.objectiveName} · <span className="text-indigo-500">{shiftPostLabel(shift)}</span></span>
                    <span className={`shrink-0 font-bold ${isSameDay(shift.shiftDateObj, now) ? 'text-slate-400' : 'text-amber-500'}`}>{isSameDay(shift.shiftDateObj, now) ? 'HOY' : formatDateShort(shift.shiftDateObj)}</span>
                    <span className="shrink-0 font-mono">{displayShiftTimeRange(shift)}</span>
                </div>
            </div>
            <div className="flex gap-1 shrink-0">
                {!shift.isUnassigned && (<button onClick={() => onOpenWA(shift)} className={`p-1.5 border rounded-lg hover:bg-emerald-100 transition-colors ${shift.phone ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`} title={shift.phone ? 'WhatsApp' : 'Sin teléfono'}><MessageCircle size={12}/></button>)}
                {canCover && viewTab === 'VACANTES' && (<button onClick={() => onOpenCoverage(shift)} className="p-1.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors" title="Cubrir"><Siren size={12}/></button>)}
                {canReturn && viewTab === 'VACANTES' && (<button onClick={handleReport} className="p-1.5 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors" title="Devolver a planificación"><CornerUpLeft size={12}/></button>)}
                {shift.isReportedToPlanning && viewTab === 'VACANTES' && (<span className="text-[9px] font-bold text-slate-500 uppercase px-1 shrink-0">Devuelto</span>)}
                {viewTab === 'PLAN' && (<><button onClick={() => onOpenHandover(shift)} disabled={!canCheckIn} className={`p-1.5 rounded-lg transition-colors ${canCheckIn ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`} title="Dar presente"><PlayCircle size={12}/></button><button onClick={() => onOpenAttendance(shift)} className="p-1.5 bg-amber-50 text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors" title="Marcar ausente"><AlertTriangle size={12}/></button></>)}
                {(viewTab === 'PRIORIDAD' || viewTab === 'NO_LLEGO') && canCheckIn && !shift.isPresent && (
                    <button onClick={() => onOpenHandover(shift)} className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors" title="Dar presente"><PlayCircle size={12}/></button>
                )}
                {(viewTab === 'ACTIVOS' || viewTab === 'RETENIDOS') && (<><button onClick={() => onOpenManualRetention?.(shift)} className="p-1.5 bg-orange-50 text-orange-600 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors" title="Retención manual"><Timer size={12}/></button><button onClick={() => onOpenCheckout(shift)} className="p-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors" title="Salida"><LogOut size={12}/></button><button onClick={() => onOpenInterrupt(shift)} className="p-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors" title="Baja anticipada"><Siren size={12}/></button></>)}
                {viewTab === 'AUSENTES' && (shift.isAbsent
                    ? (() => {
                        const endMs = shift.endDateObj?.getTime?.() ?? 0;
                        const shiftEnded = endMs > 0 && Date.now() > endMs;
                        return shiftEnded
                            ? <span className="text-[9px] px-2 py-1 rounded bg-slate-100 text-slate-400 font-bold">VENCIDO</span>
                            : <div className="flex gap-1">
                                <span className="text-[9px] px-2 py-1 rounded bg-rose-50 text-rose-500 border border-rose-200 font-bold">→ VAC</span>
                                <button onClick={() => onRevertAbsence && onRevertAbsence(shift)} className="p-1.5 bg-slate-50 text-slate-400 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors" title="Revertir ausencia — error de sistema"><XCircle size={12}/></button>
                              </div>;
                      })()
                    : <button onClick={() => onOpenAttendance(shift)} className="p-1.5 bg-amber-50 text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors" title="Confirmar ausencia"><AlertTriangle size={12}/></button>
                )}
            </div>
        </div>
    );

    // â"€â"€ Vista expandida â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    return (
        <div className={`relative rounded-xl border border-slate-200 mb-2 shadow-sm overflow-hidden transition-all ${rowBg}`}>
            <div className={`h-1 w-full ${accentColor}`}/>
            <div className="px-3 pt-2.5 pb-1.5">
                {/* Fila 1: nombre + badge + hora */}
                <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black shrink-0 ${avatarClass} ${refuerzoLabel ? 'text-[9px] tracking-tight' : 'text-[11px]'}`}>
                            {avatarLabel}
                        </div>
                        <div className="min-w-0">
                            <span className={`text-[13px] font-black block truncate ${shift.isUnassigned ? 'text-rose-600' : 'text-slate-800'}`}>{name}</span>
                            <span className="text-[10px] text-slate-400">{shift.clientName || shift.objectiveName}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">{badge}</div>
                </div>
                {/* Fila 2: objetivo · posición */}
                <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-1.5 pl-10">
                    <MapPin size={10} className="text-indigo-400 shrink-0"/>
                    <span className="truncate font-medium">{shift.objectiveName}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-indigo-600 font-bold truncate">{shiftPostLabel(shift)}</span>
                    {shift.turaContiguous && shift.turaImputationPos && (
                        <span className="text-violet-600 font-bold shrink-0">+TURA {shift.turaImputationPos}</span>
                    )}
                    <span className="ml-auto font-mono text-slate-600 shrink-0 flex items-center gap-1">
                        <span className={`font-bold not-font-mono text-[9px] ${isSameDay(shift.shiftDateObj, now) ? 'text-slate-400' : 'text-amber-500'}`}>{isSameDay(shift.shiftDateObj, now) ? 'HOY' : formatDateShort(shift.shiftDateObj)}</span>
                        {displayShiftTimeRange(shift)}
                    </span>
                </div>
                {/* Franja retención */}
                {(shift.isRetention || shift.manualRetentionType) && (
                    <div className="flex items-center gap-1.5 text-[9px] font-bold text-orange-700 bg-orange-50 border border-orange-100 rounded-lg px-2.5 py-1 mb-1.5 ml-10">
                        <Timer size={9} className="text-orange-500 shrink-0"/>
                        {shift.manualRetentionType === 'extended' && <>
                            Extensión manual +{shift.manualRetentionHours}h
                            {shift.endDateObj && <span className="text-orange-500 font-normal ml-1">· corte {shift.endDateObj.toLocaleTimeString?.('es-AR',{hour:'2-digit',minute:'2-digit'})}</span>}
                        </>}
                        {shift.manualRetentionType === 'open' && <>
                            Retención manual indefinida
                            {shift.retentionUntil && <span className="text-orange-500 font-normal ml-1">· máx. {shift.retentionUntil.toDate?.()?.toLocaleTimeString?.('es-AR',{hour:'2-digit',minute:'2-digit'})}</span>}
                        </>}
                        {!shift.manualRetentionType && shift.isRetention && <>
                            Recargo automático{shift.retentionMinutes > 0 && <span className="ml-1">· +{shift.retentionMinutes} min</span>}
                        </>}
                    </div>
                )}
                {/* Fila 3: botones con texto */}
                <div className="flex gap-1.5 flex-wrap pl-10">
                    {!shift.isUnassigned && (<button onClick={() => onOpenWA(shift)} className={`flex items-center gap-1 px-2.5 py-1.5 border rounded-lg text-[10px] font-bold hover:bg-emerald-100 transition-colors ${shift.phone ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}><MessageCircle size={11}/>WA</button>)}
                    {canCover && viewTab === 'VACANTES' && (
                        <button onClick={() => onOpenCoverage(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-600 text-white rounded-lg text-[10px] font-bold hover:bg-rose-700 transition-colors"><Siren size={11}/>CUBRIR</button>
                    )}
                    {canReturn && viewTab === 'VACANTES' && (
                        <button onClick={handleReport} className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-700 text-white rounded-lg text-[10px] font-bold hover:bg-slate-800 transition-colors"><CornerUpLeft size={11}/>DEVOLVER</button>
                    )}
                    {shift.isReportedToPlanning && viewTab === 'VACANTES' && (<span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1 px-2 py-1.5"><CornerUpLeft size={10}/>Devuelto</span>)}
                    {viewTab === 'PLAN' && (<>
                        {!shift.hasRRHHNovedad && <button onClick={() => onOpenHandover(shift)} disabled={!canCheckIn} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${canCheckIn ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}><PlayCircle size={11}/>DAR PRESENTE</button>}
                        {shift.hasRRHHNovedad
                            ? <button onClick={() => onOpenRRHH(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-bold hover:bg-blue-700 transition-colors"><BellRing size={11}/>NOVEDAD RRHH</button>
                            : diff >= 5
                                ? <button onClick={() => onOpenAttendance(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-[10px] font-bold hover:bg-amber-100 transition-colors"><AlertTriangle size={11}/>AUSENTE</button>
                                : <button onClick={() => onNovedadAbsence(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-sky-50 text-sky-700 border border-sky-200 rounded-lg text-[10px] font-bold hover:bg-sky-100 transition-colors"><BellRing size={11}/>NOVEDAD</button>
                        }
                    </>)}
                    {shift.isRRHHUrgent && (viewTab === 'PRIORIDAD') && (
                        <button onClick={() => onOpenRRHH(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-500 text-white rounded-lg text-[10px] font-bold hover:bg-orange-600 transition-colors"><Siren size={11}/>NOVEDAD RRHH</button>
                    )}
                    {(viewTab === 'PRIORIDAD' || viewTab === 'NO_LLEGO') && canCheckIn && !shift.isPresent && (
                        <button onClick={() => onOpenHandover(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-bold hover:bg-indigo-700 transition-colors"><PlayCircle size={11}/>DAR PRESENTE</button>
                    )}
                    {viewTab === 'NO_LLEGO' && shift.isLateUnnotified && (
                        <button onClick={() => onOpenAbsenceDecision(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 text-white rounded-lg text-[10px] font-bold hover:bg-amber-600 transition-colors"><AlertTriangle size={11}/>DECIDIR</button>
                    )}
                    {(viewTab === 'ACTIVOS' || viewTab === 'RETENIDOS') && (<>
                        <button onClick={() => onOpenCheckout(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-purple-600 text-white rounded-lg text-[10px] font-bold hover:bg-purple-700 transition-colors"><LogOut size={11}/>SALIDA</button>
                        <button onClick={() => onOpenInterrupt(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-[10px] font-bold hover:bg-red-100 transition-colors"><Siren size={11}/>BAJA</button>
                    </>)}
                    {viewTab === 'AUSENTES' && (shift.isAbsent
                        ? (() => {
                            const endMs = shift.endDateObj?.getTime?.() ?? 0;
                            const shiftEnded = endMs > 0 && Date.now() > endMs;
                            return shiftEnded
                                ? <span className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 text-slate-400 rounded-lg text-[10px] font-bold">VENCIDO</span>
                                : <div className="flex gap-1.5 items-center">
                                    <span className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 text-rose-500 border border-rose-200 rounded-lg text-[10px] font-bold">→ Cubrir desde VACANTES</span>
                                    <button onClick={() => onRevertAbsence && onRevertAbsence(shift)} className="p-1.5 bg-slate-50 text-slate-400 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors" title="Revertir ausencia"><XCircle size={11}/></button>
                                  </div>;
                          })()
                        : <button onClick={() => onOpenAttendance(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-[10px] font-bold hover:bg-amber-100 transition-colors"><AlertTriangle size={11}/>CONFIRMAR AUSENCIA</button>
                    )}
                </div>
            </div>
        </div>
    );
};

const splitShiftsByEvent = (items: any[]) => {
    const regular: any[] = [];
    const groups = new Map<string, { id: string; label: string; items: any[] }>();
    (items || []).forEach((shift: any) => {
        if (!isEventShift(shift)) {
            regular.push(shift);
            return;
        }
        const groupKey = getEventGroupKey(shift);
        if (!groups.has(groupKey)) {
            groups.set(groupKey, {
                id: groupKey,
                label: getEventGroupLabel(shift),
                items: [],
            });
        }
        groups.get(groupKey)!.items.push(shift);
    });
    const eventGroups = Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
    return { regular, eventGroups };
};

const ObjectiveGroup = ({ group, modals, isCompact, onReport, viewTab, onOpenWorkedFranco, onNovedadAbsence, onOpenWA, onOpenAbsenceDecision, onOpenRRHH, isAutoMode, isPublished }: any) => {
    const [expanded, setExpanded] = useState(true);
    const split = useMemo(() => splitShiftsByEvent(group.items || []), [group.items]);
    return (
        <div className={`bg-white rounded-xl border shadow-sm overflow-hidden mb-3 ${isPublished === false ? 'border-amber-300' : 'border-slate-300'}`}>
            <div className={`px-3 py-2 border-b flex justify-between items-center cursor-pointer ${isPublished === false ? 'bg-amber-50 border-amber-200 hover:bg-amber-100' : 'bg-slate-100 border-slate-200 hover:bg-slate-200'}`} onClick={() => setExpanded(!expanded)}>
                <div className="flex items-center gap-2 min-w-0">
                    <div className="bg-slate-700 text-white w-5 h-5 rounded flex items-center justify-center text-[10px] font-black shrink-0">{group.items.length}</div>
                    <div className="min-w-0">
                        <h4 className="font-black text-xs text-slate-800 uppercase truncate leading-tight">{group.name}</h4>
                        {group.client && <span className="text-[9px] text-slate-400 font-medium truncate block leading-tight">{group.client}</span>}
                    </div>
                    {isPublished === false && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-200 text-amber-800 shrink-0">BORRADOR</span>}
                </div>
                {expanded ? <ChevronDown size={16} className="text-slate-400 shrink-0"/> : <ChevronRight size={16} className="text-slate-400 shrink-0"/>}
            </div>
            {expanded && (
                <div className="p-2 bg-slate-50 space-y-2">
                    {split.eventGroups.length > 0 && (
                        <div className="space-y-2">
                            {split.eventGroups.map((ev) => (
                                <div key={ev.id} className="rounded-xl border border-amber-200 bg-amber-50/60">
                                    <div className="px-2.5 py-1.5 border-b border-amber-200 flex items-center justify-between gap-2">
                                        <span className="text-[10px] font-black uppercase tracking-wide text-amber-800 truncate">{ev.label}</span>
                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 shrink-0">{ev.items.length} guardia(s)</span>
                                    </div>
                                    <div className="p-1.5 space-y-1.5 bg-white/80">
                                        {ev.items.map((s: any) => (
                                            <GuardCard key={s.id} shift={s} viewTab={viewTab} isCompact={isCompact} isAutoMode={isAutoMode}
                                                onOpenCheckout={(s: any) => modals.setCheckoutData({ isOpen: true, shift: s })}
                                                onOpenAttendance={(s: any) => modals.setAttendanceData({ isOpen: true, shift: s })}
                                                onOpenHandover={(s: any) => modals.setHandoverData({ isOpen: true, shift: s })}
                                                onOpenInterrupt={(s: any) => modals.setInterruptData({ isOpen: true, shift: s })}
                                                onOpenCoverage={(s: any) => modals.setCoverageData({ isOpen: true, shift: s })}
                                                onReportPlanning={onReport} onOpenWorkedFranco={onOpenWorkedFranco}
                                                onNovedadAbsence={onNovedadAbsence} onOpenWA={onOpenWA} onOpenAbsenceDecision={onOpenAbsenceDecision} onOpenRRHH={onOpenRRHH}
                                                onOpenManualRetention={(s: any) => modals.setManualRetentionData({ isOpen: true, shift: s })}/>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {split.regular.map((s: any) => (
                        <GuardCard key={s.id} shift={s} viewTab={viewTab} isCompact={isCompact} isAutoMode={isAutoMode}
                            onOpenCheckout={(s: any) => modals.setCheckoutData({ isOpen: true, shift: s })}
                            onOpenAttendance={(s: any) => modals.setAttendanceData({ isOpen: true, shift: s })}
                            onOpenHandover={(s: any) => modals.setHandoverData({ isOpen: true, shift: s })}
                            onOpenInterrupt={(s: any) => modals.setInterruptData({ isOpen: true, shift: s })}
                            onOpenCoverage={(s: any) => modals.setCoverageData({ isOpen: true, shift: s })}
                            onReportPlanning={onReport} onOpenWorkedFranco={onOpenWorkedFranco}
                            onNovedadAbsence={onNovedadAbsence} onOpenWA={onOpenWA} onOpenAbsenceDecision={onOpenAbsenceDecision} onOpenRRHH={onOpenRRHH}
                            onOpenManualRetention={(s: any) => modals.setManualRetentionData({ isOpen: true, shift: s })}/>
                    ))}
                </div>
            )}
        </div>
    );
};

// Formatea duración en HH:MM desde una fecha de inicio
const useElapsedTime = (startTime: Date | null) => {
    const [elapsed, setElapsed] = useState('');
    useEffect(() => {
        if (!startTime) { setElapsed(''); return; }
        const update = () => {
            const diff = Math.max(0, Date.now() - startTime.getTime());
            const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
            const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
            setElapsed(`${h}:${m}`);
        };
        update();
        const t = setInterval(update, 30000);
        return () => clearInterval(t);
    }, [startTime]);
    return elapsed;
};

export default function OperacionesPage() {
    const router = useRouter();
    const { assignedClientId, userRole, isSuperAdmin } = useAuth();
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = !!(empresa as any)?.migracionCompleta;
    const centroControlEnabled = empresa?.centroControlEnabled !== false;
    const logic = useOperacionesMonitor(assignedClientId);
    const session = useOperatorSession();
    const elapsed = useElapsedTime(session.mySession?.startTime || null);
    useAutoMonitor({
        isActive: centroControlEnabled,
        isAutoMode: session.isAutoMode,
        empresaId,
        activeOperatorId: session.mySession?.operatorId || null,
        processedData: logic.processedData,
    });

    // Rol CC: operadores cuya única misión es el CC — se les auto-inicia guardia al abrir
    // Supervisores y superadmin pueden entrar sin iniciar guardia
    const isCCOperator = !isSuperAdmin && (userRole === 'OPERADOR' || userRole === 'OPERADOR_CC');

    // Auto-inicio de guardia para rol OPERADOR cuando data está lista
    const autoStartedRef = useRef(false);
    useEffect(() => {
        if (!centroControlEnabled) return;
        if (!isCCOperator) return;
        if (!logic.isReady) return;
        if (session.loading) return;
        if (session.isMySession) return;
        if (autoStartedRef.current) return;
        autoStartedRef.current = true;
        session.startSession().catch(e => console.warn('[CC auto-start]', e));
    }, [centroControlEnabled, isCCOperator, logic.isReady, session.loading, session.isMySession]);

    // Audit log: registra cada vez que el modo automático cambia (operador entra/sale de guardia)
    const prevAutoModeRef = useRef<boolean | null>(null);
    useEffect(() => {
        if (session.loading) return;
        if (prevAutoModeRef.current === session.isAutoMode) return;
        const wasInit = prevAutoModeRef.current === null;
        prevAutoModeRef.current = session.isAutoMode;
        if (wasInit) return; // primera carga, no auditar
        const authInst = getAuth();
        const uid = authInst.currentUser?.uid;
        if (!uid || !empresaId) return;
        addDoc(collection(db, 'audit_logs'), {
            action: session.isAutoMode ? 'GUARDIA_FINALIZADA' : 'GUARDIA_INICIADA',
            actorId: uid,
            actorName: authInst.currentUser?.email?.split('@')[0] || 'Operador',
            userRole: userRole || 'desconocido',
            autoStarted: isCCOperator && !session.isAutoMode,
            empresaId,
            timestamp: serverTimestamp(),
            details: session.isAutoMode
                ? 'Operador finalizó guardia en CC'
                : (isCCOperator ? 'Guardia iniciada automáticamente (rol OPERADOR)' : 'Operador inició guardia manualmente'),
        }).catch(() => {});
    }, [session.isAutoMode, session.loading]);

    const [detailNovedad, setDetailNovedad] = useState<any>(null);
    const [showDebugPanel, setShowDebugPanel] = useState(false);
    const [isExternalMap, setIsExternalMap] = useState(false);
    const [mapCollapsed, setMapCollapsed] = useState(false);
    const [showCoverageGrid, setShowCoverageGrid] = useState(false);
    // Auto-colapsar mapa en mobile al montar
    useEffect(() => {
        if (typeof window !== 'undefined' && window.innerWidth < 1024) {
            setMapCollapsed(true);
        }
    }, []);
    const [confirmEndSession, setConfirmEndSession] = useState(false);
    const [checkoutData, setCheckoutData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [attendanceData, setAttendanceData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [handoverData, setHandoverData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    // Guard contra race condition: IDs relevados en esta sesión excluidos de futuros activeGuards
    const recentlyRelievedRef = useRef<Set<string>>(new Set());
    const [interruptData, setInterruptData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [coverageData, setCoverageData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [workedFrancoData, setWorkedFrancoData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [absenceDecisionData, setAbsenceDecisionData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [rrhhVacancyData, setRrhhVacancyData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [manualRetentionData, setManualRetentionData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [waData, setWaData] = useState<{ isOpen: boolean; ctx: WAComposeContext }>({ isOpen: false, ctx: { employeeName: '', phone: '' } });
    const [isGrouped, setIsGrouped] = useState(true);
    const [viewMode, setViewMode] = usePersistedState<'objetivos' | 'lista'>('cosp:ops:viewMode', 'objetivos');
    const [expandedObjectiveId, setExpandedObjectiveId] = usePersistedState<string | null>('cosp:ops:expandedObj', null);
    const [bitacoraTab, setBitacoraTab] = useState<'reciente'|'operaciones'|'alertas'>('reciente');
    const [bitacoraOpen, setBitacoraOpen] = useState(false);
    const [bitacoraExpanded, setBitacoraExpanded] = useState<string | null>(null);
    const [bitacoraFiltroObj, setBitacoraFiltroObj] = useState<string>('');
    const [bitacoraFiltroTipo, setBitacoraFiltroTipo] = useState<string>('');
    const [bitacoraFiltroGuardia, setBitacoraFiltroGuardia] = useState(false);
    const bitacoraLastOpenRef = useRef<number>(Date.now());
    // ── Alertas sonoras ──────────────────────────────────────────────────────────
    const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
        try { return localStorage.getItem('ops_sound_enabled') !== 'false'; } catch { return true; }
    });
    const audioCtxRef = useRef<AudioContext | null>(null);
    const prevPendingCountRef = useRef<number>(-1);
    const getAudioCtx = () => {
        if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        return audioCtxRef.current;
    };
    const playAlertSound = (urgent: boolean) => {
        try {
            const ctx = getAudioCtx();
            if (ctx.state === 'suspended') ctx.resume();
            const now = ctx.currentTime;
            const gain = ctx.createGain();
            gain.connect(ctx.destination);
            if (urgent) {
                // Dos tonos cortos descendentes — más notorio
                [[880, 0, 0.12], [660, 0.15, 0.12], [880, 0.32, 0.12], [660, 0.47, 0.12]].forEach(([freq, start, dur]) => {
                    const osc = ctx.createOscillator();
                    const g2 = ctx.createGain();
                    osc.type = 'square'; osc.frequency.value = freq as number;
                    g2.gain.setValueAtTime(0.18, now + (start as number));
                    g2.gain.exponentialRampToValueAtTime(0.001, now + (start as number) + (dur as number));
                    osc.connect(g2); g2.connect(ctx.destination);
                    osc.start(now + (start as number)); osc.stop(now + (start as number) + (dur as number));
                });
            } else {
                // Un tono suave
                const osc = ctx.createOscillator();
                gain.gain.setValueAtTime(0.12, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
                osc.type = 'sine'; osc.frequency.setValueAtTime(660, now);
                osc.frequency.linearRampToValueAtTime(880, now + 0.15);
                osc.connect(gain); osc.start(now); osc.stop(now + 0.3);
            }
        } catch { /* Safari sin permiso */ }
    };
    const toggleSound = () => {
        const next = !soundEnabled;
        setSoundEnabled(next);
        try { localStorage.setItem('ops_sound_enabled', String(next)); } catch {}
        if (next) playAlertSound(false); // preview al activar
    };
    const [cierreGuardiaOpen, setCierreGuardiaOpen] = useState(false);
    const [cierreObs, setCierreObs] = useState('');
    const [cierreLoading, setCierreLoading] = useState(false);
    const [empNovedades, setEmpNovedades] = useState<any[]>([]);
    const [notifPanelOpen, setNotifPanelOpen] = useState(false);
    const [authorizedAbsences, setAuthorizedAbsences] = useState<any[]>([]);
    const [absencesPanelOpen, setAbsencesPanelOpen] = useState(true);
    // Refresh key: reconecta listeners al volver de background o recuperar red
    const [listenerRefreshKey, setListenerRefreshKey] = useState(0);
    useEffect(() => {
        const bump = () => setListenerRefreshKey(k => k + 1);
        const onVisible = () => { if (document.visibilityState === 'visible') bump(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', bump);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', bump);
        };
    }, []);

    const recentAtendidas = useMemo(() =>
        empNovedades.filter(n => n.status === 'ATENDIDA' || n.status === 'atendida').slice(0, 8),
    [empNovedades]);

    const COVERAGE_GRACE_MINUTES = 60; // tiempo de gracia para gestionar cobertura

    const pendingNovedades = useMemo(() => {
        const now = Date.now();
        return empNovedades.filter(n => {
            if (n.status === 'ATENDIDA' || n.status === 'atendida') return false;
            if (n.type === 'VACANTE_A_PLANIFICACION') return false; // auto-procesada
            if (n.enGestion) return false; // otro operador (mapa) la está gestionando

            // TURA-extensión ya mergeada en el turno del guardia: no alertar como vacante
            if ((n.type === 'VACANTE_OPERATIVA' || n.type === 'TURA_EXTENSION') && n.tipoSolicitud === 'TURA' && n.parentEmpleadoId) {
                const target = resolveTuraExtensionOperacionesTarget(n, logic.processedData);
                if (target?.turaContiguous) return false;
            }

            // Protocolo de cobertura: no mostrar si el turno ya terminó o venció el tiempo de gracia
            if (n.type === 'VACANTE_PROTOCOLO_COBERTURA') {
                // Buscar el turno en processedData por shiftId o virtualVacancyId
                const refId = n.shiftId || n.virtualVacancyId;
                const shift = refId
                    ? logic.processedData.find((s: any) => s.id === refId)
                    : logic.processedData.find((s: any) =>
                        s.objectiveId === n.objectiveId &&
                        (s.positionName || '').toLowerCase() === (n.positionName || '').toLowerCase() &&
                        !s.isCompleted
                    );

                if (shift) {
                    const endMs = shift.endDateObj?.getTime?.() ?? 0;
                    const startMs = shift.shiftDateObj?.getTime?.() ?? 0;
                    const graceMs = COVERAGE_GRACE_MINUTES * 60 * 1000;

                    // Ocultar si el turno ya terminó
                    if (endMs > 0 && now > endMs) return false;
                    // Ocultar si superó el tiempo de gracia desde el inicio
                    if (startMs > 0 && now > startMs + graceMs) return false;
                } else {
                    // Sin turno encontrado: ocultar si la novedad tiene más de 2 horas
                    const createdMs = n.createdAt?.seconds ? n.createdAt.seconds * 1000 : 0;
                    if (createdMs && now - createdMs > 2 * 3600 * 1000) return false;
                }
            }

            return true;
        });
    }, [empNovedades, logic.processedData]);

    useEffect(() => {
        const since = Timestamp.fromDate(new Date(Date.now() - 48 * 3600 * 1000));
        const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, !!(empresa as any)?.migracionCompleta);
        const novedadesQ = scopeEmpresa
            ? query(collection(db, 'novedades'), where('empresaId', '==', empresaId), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(200))
            : query(collection(db, 'novedades'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(200));
        const unsub = onSnapshotFresh(
            novedadesQ,
            snap => {
                const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                docs.sort((a: any, b: any) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
                setEmpNovedades(docs);
            },
            err => {
                console.warn('[operaciones] novedades listener error, reconectando:', err.code);
                setListenerRefreshKey(k => k + 1);
            }
        );
        return () => unsub();
    }, [empresaId, empresa, listenerRefreshKey]);

    useEffect(() => {
        const todayStr = new Date().toLocaleDateString('en-CA');
        const normDate = (v: any): string => {
            if (!v) return '';
            if (typeof v === 'string') return v.slice(0, 10);
            if (v.seconds) return new Date(v.seconds * 1000).toLocaleDateString('en-CA');
            return new Date(v).toLocaleDateString('en-CA');
        };
        const scopeAus = shouldScopeQueriesToEmpresa(empresaId, !!(empresa as any)?.migracionCompleta);
        const ausQ = scopeAus
            ? query(collection(db, 'ausencias'), where('empresaId', '==', empresaId), where('status', '==', 'Autorizada'))
            : query(collection(db, 'ausencias'), where('status', '==', 'Autorizada'));
        const unsub = onSnapshotFresh(
            ausQ,
            snap => {
                const docs = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter((a: any) => {
                        const s = normDate(a.startDate);
                        const e = normDate(a.endDate);
                        return s && e && s <= todayStr && todayStr <= e;
                    });
                docs.sort((a: any, b: any) => (a.employeeName || '').localeCompare(b.employeeName || ''));
                setAuthorizedAbsences(docs);
            },
            err => {
                console.warn('[operaciones] ausencias listener error, reconectando:', err.code);
                setListenerRefreshKey(k => k + 1);
            }
        );
        return () => unsub();
    }, [empresaId, empresa, listenerRefreshKey]);

    // Persiste en localStorage para no re-abrir el modal tras recargar la página
    const ABSENT_ACK_KEY = `ops_absent_ack_${new Date().toLocaleDateString('en-CA')}`;
    const _loadAcked = (): Set<string> => {
        try { return new Set(JSON.parse(localStorage.getItem(ABSENT_ACK_KEY) || '[]')); } catch { return new Set(); }
    };
    const autoAbsentTriggeredRef = useRef<Set<string>>(_loadAcked());

    useEffect(() => {
        const now = Date.now();
        const newlyAbsent = logic.processedData.filter((s: any) => {
            if (!s.isAbsent || s.absenceType !== 'AA') return false;
            if (!isSameDay(s.shiftDateObj, new Date())) return false;
            if (autoAbsentTriggeredRef.current.has(s.id)) return false;
            // No auto-abrir si ya pasó el tiempo de gracia — el operador puede abrir manualmente
            const startMs = s.shiftDateObj?.getTime?.() ?? 0;
            if (startMs > 0 && now > startMs + COVERAGE_GRACE_MINUTES * 60 * 1000) return false;
            return true;
        });
        if (!newlyAbsent.length) return;
        newlyAbsent.forEach((s: any) => {
            autoAbsentTriggeredRef.current.add(s.id);
        });
        // Persistir en localStorage para no re-abrir tras recarga
        try { localStorage.setItem(ABSENT_ACK_KEY, JSON.stringify([...autoAbsentTriggeredRef.current])); } catch {}
        logic.setViewTab('AUSENTES');
        setCoverageData({ isOpen: true, shift: newlyAbsent[0] });
    }, [logic.processedData]);

    const openHandoverFromNovedad = (novedad: any) => {
        const targetShift = novedad.shiftId
            ? logic.processedData.find((s: any) => s.id === novedad.shiftId)
            : logic.processedData.find((s: any) =>
                s.employeeId === novedad.employeeId &&
                s.objectiveId === novedad.objectiveId &&
                !s.isPresent && !s.isCompleted
            );
        if (targetShift) {
            setHandoverData({ isOpen: true, shift: targetShift });
            logic.setViewTab('PRIORIDAD');
            toast.info(`Dar presente a ${targetShift.employeeName || novedad.employeeName || 'guardia'}`);
            return true;
        }
        logic.setViewTab('PRIORIDAD');
        toast.info('Buscá al guardia en PRIORIDAD para dar presente.');
        return false;
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
                    status: 'ATENDIDA',
                    atendidaAt: serverTimestamp(),
                    atendidaPor: actorName,
                    atendidaPorUid: auth.currentUser?.uid || null,
                });
            });
            await batch.commit();
            addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                action: 'DESCARTAR_NOVEDADES_TIPO',
                module: 'OPERACIONES',
                actorName,
                timestamp: serverTimestamp(),
                details: `Descartó ${toAtend.length} novedades tipo ${type}.`,
            }, empresaId)).catch(() => {});
            toast.success(`${toAtend.length} novedades descartadas`);
        } catch(e) { toast.error('Error al descartar novedades'); }
    };

    // Limpia novedades duplicadas: para cada (type, shiftId) con >1 pending,
    // marca todas menos la más reciente como ATENDIDA.
    const cleanupDuplicateNovedades = async () => {
        const auth = getAuth();
        const actorName = auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'Operador';
        // Agrupar por type+shiftId
        const groups = new Map<string, any[]>();
        pendingNovedades.forEach((n: any) => {
            const key = `${n.type}__${n.shiftId || n.id}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(n);
        });
        const toDiscard: any[] = [];
        groups.forEach((items) => {
            if (items.length <= 1) return;
            // Ordenar por createdAt desc — conservar el más reciente
            const sorted = [...items].sort((a, b) => {
                const ta = a.createdAt?.seconds ?? 0;
                const tb = b.createdAt?.seconds ?? 0;
                return tb - ta;
            });
            toDiscard.push(...sorted.slice(1)); // todos menos el primero (más reciente)
        });
        if (!toDiscard.length) { toast.info('No hay duplicados pendientes'); return; }
        try {
            // writeBatch acepta max 500 ops — chunk si hay muchos
            const CHUNK = 400;
            for (let i = 0; i < toDiscard.length; i += CHUNK) {
                const batch = writeBatch(db);
                toDiscard.slice(i, i + CHUNK).forEach((n: any) => {
                    batch.update(doc(db, 'novedades', n.id), {
                        status: 'ATENDIDA',
                        atendidaAt: serverTimestamp(),
                        atendidaPor: actorName,
                        atendidaPorUid: auth.currentUser?.uid || null,
                        autoCleanupDuplicate: true,
                    });
                });
                await batch.commit();
            }
            toast.success(`${toDiscard.length} alertas duplicadas limpiadas`);
        } catch (e: any) { toast.error('Error al limpiar: ' + e.message); }
    };

    const handleAtenderNovedad = async (novedad: any) => {
        try {
            const auth = getAuth();
            const actorName = auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'Operador';
            await updateDoc(doc(db, 'novedades', novedad.id), {
                status: 'ATENDIDA',
                atendidaAt: serverTimestamp(),
                atendidaPor: actorName,
                atendidaPorUid: auth.currentUser?.uid || null,
            });
            addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                action: 'ATENDER_NOVEDAD',
                module: 'OPERACIONES',
                actorName,
                timestamp: serverTimestamp(),
                objectiveId: novedad.objectiveId,
                objectiveName: novedad.objectiveName,
                details: `Atendió novedad: ${novedad.type}${novedad.description ? ` — ${novedad.description}` : ''}.`,
            }, String(novedad.empresaId || empresaId || '').trim())).catch(() => {});

            if (novedad.type === 'VACANTE_A_PLANIFICACION') {
                // Ya fue auto-devuelta, solo informar
                toast.success('Vacante devuelta a planificación');
                logic.setViewTab('VACANTES');

            } else if (novedad.type === 'VACANTE_PROTOCOLO_COBERTURA') {
                // Buscar turno virtual para abrir modal CUBRIR
                const vacShift = logic.processedData.find((s: any) =>
                    s.id === novedad.virtualVacancyId ||
                    (s.isVirtual && s.objectiveId === novedad.objectiveId &&
                     (s.positionName || '').toLowerCase() === (novedad.positionName || '').toLowerCase())
                );
                if (vacShift) {
                    // Materializar si virtual y abrir cobertura
                    if (vacShift.isVirtual || !novedad.shiftId) {
                        const newRef = doc(collection(db, 'turnos'));
                        await setDoc(newRef, stampEmpresaId({
                            clientId: vacShift.clientId, clientName: vacShift.clientName,
                            objectiveId: vacShift.objectiveId, objectiveName: vacShift.objectiveName,
                            positionName: vacShift.positionName,
                            employeeId: 'VACANTE', employeeName: 'VACANTE',
                            startTime: Timestamp.fromDate(vacShift.shiftDateObj),
                            endTime: Timestamp.fromDate(vacShift.endDateObj),
                            status: 'REPORTED_TO_PLANNING', isReported: true, isReportedToPlanning: true,
                            origin: 'SLA_VIRTUAL', createdAt: serverTimestamp(),
                        }, String(vacShift.empresaId || novedad.empresaId || empresaId || '').trim()));
                        setCoverageData({ isOpen: true, shift: { ...vacShift, id: newRef.id } });
                    } else {
                        setCoverageData({ isOpen: true, shift: vacShift });
                    }
                    logic.setViewTab('VACANTES');
                } else {
                    logic.setViewTab('VACANTES');
                    toast.info('Usá el botón CUBRIR en la vacante correspondiente');
                }

            } else if (novedad.type === 'TURA_EXTENSION' || (novedad.type === 'VACANTE_OPERATIVA' && novedad.tipoSolicitud === 'TURA' && novedad.parentEmpleadoId)) {
                const target = resolveTuraExtensionOperacionesTarget(novedad, logic.processedData);
                if (target) {
                    logic.setViewTab('PLAN');
                    setHandoverData({ isOpen: true, shift: target });
                    toast.info(target.turaContiguous
                        ? `Turno extendido: ${target.employeeName} · ${displayShiftTimeRange(target)}`
                        : `2º tramo TURA: ${target.employeeName} · ${displayShiftTimeRange(target)}`);
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
                toast.info('Planificación — fila VACANTE RFZ: asigná guardia y publicá el cronograma.');

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
                openHandoverFromNovedad(novedad);

            } else if (novedad.type === 'AUSENCIA_AUTO' || novedad.type === 'RELEVO_NO_PRESENTADO') {
                logic.setViewTab('AUSENTES');
                toast.info('Revisá la pestaña AUSENTES para gestionar');

            } else if (novedad.type === 'AUSENCIA_CORTO_PLAZO' || novedad.type === 'AVISO_AUSENCIA_ANTICIPADA') {
                // Buscar el turno afectado y abrir CoverageModal directamente
                const targetShift = novedad.shiftId
                    ? logic.processedData.find((s: any) => s.id === novedad.shiftId)
                    : logic.processedData.find((s: any) =>
                        s.objectiveId === novedad.objectiveId &&
                        (s.positionName || '').toLowerCase() === (novedad.positionName || '').toLowerCase() &&
                        !s.isCompleted
                    );
                if (targetShift) {
                    setCoverageData({ isOpen: true, shift: targetShift });
                    toast.info(`Protocolo de cobertura abierto para ${novedad.employeeName || 'empleado'}`);
                } else {
                    toast.info('Turno no encontrado. Buscá en PLAN o AUSENTES.');
                }

            } else {
                toast.success('Alerta atendida');
            }
        } catch(e) { toast.error('Error al atender la alerta'); }
    };

    const prevPendingCount = useRef(0);
    useEffect(() => {
        if (pendingNovedades.length > prevPendingCount.current) {
            setNotifPanelOpen(true);
        }
        prevPendingCount.current = pendingNovedades.length;
    }, [pendingNovedades.length]);

    // ── Alertas sonoras: disparar cuando llegan novedades nuevas
    useEffect(() => {
        if (!soundEnabled) { prevPendingCountRef.current = pendingNovedades.length; return; }
        if (prevPendingCountRef.current < 0) { prevPendingCountRef.current = pendingNovedades.length; return; }
        if (pendingNovedades.length > prevPendingCountRef.current) {
            const hasUrgent = pendingNovedades.some((n: any) =>
                ['VACANTE_PROTOCOLO_COBERTURA', 'VACANTE_NO_CUBIERTA'].includes(n.type)
            );
            playAlertSound(hasUrgent);
        }
        prevPendingCountRef.current = pendingNovedades.length;
    }, [pendingNovedades.length, soundEnabled]);

    // â"€â"€ Auto-cerrar novedades VACANTE_PROTOCOLO_COBERTURA cuando el slot ya venció sin cobertura
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

    const ACTION_LABELS: Record<string, string> = {
        CHECKIN: 'Ingreso', CHECK_IN: 'Ingreso', GUARDIA_INICIADA: 'Guardia iniciada',
        CHECKOUT: 'Salida', CHECK_OUT: 'Salida', GUARDIA_FINALIZADA: 'Guardia cerrada',
        HANDOVER: 'Ingreso (relevo)', PRESENTE: 'Presente', ENTRADA: 'Entrada',
        MARK_ABSENT: 'Ausencia declarada', AUSENTE: 'Ausencia', ATTENDANCE: 'Asistencia',
        MANUAL_ATTENDANCE: 'Asistencia manual',
        COVERAGE: 'Cobertura', COBERTURA_RELEVO: 'Cobertura relevo',
        INTERRUPT: 'Baja anticipada', BAJA_SERVICIO: 'Baja anticipada',
        RETENCION: 'Retención', EXTENSION_TURNO: 'Extensión turno',
        CONVOCATORIA_RETEN: 'Retén convocado', ADELANTO_TURNO: 'Adelanto turno',
        FRANCO_TRABAJADO: 'Franco trabajado', INTERCAMBIO_TURNO: 'Intercambio turno',
        WORKED_FRANCO: 'Franco trabajado',
        REPORT_PLANNING: 'Devuelto a planificación', VACANCY: 'Vacante',
        REPORTE: 'Reporte', LLEGADA_TARDE: 'Llegada tarde',
        AUSENCIA_AUTO: 'Ausencia automática', NOVEDADES: 'Novedad',
        VACANTE_PROTOCOLO_COBERTURA: 'Protocolo cobertura',
        ATENDER_NOVEDAD: 'Novedad atendida', GUARDIA_CERRADA: 'Guardia cerrada', PORTAL_PASSWORD_SET: 'Contraseña portal establecida',
        DESCARTAR_NOVEDADES_TIPO: 'Novedades descartadas',
        BAJA_CUBIERTA: 'Baja (cubierta)', BAJA_PROTOCOLO: 'Baja (protocolo)',
    };
    const ACTION_DOT: Record<string, string> = {
        CHECKIN: 'bg-emerald-500', CHECK_IN: 'bg-emerald-500', GUARDIA_INICIADA: 'bg-indigo-500',
        CHECKOUT: 'bg-purple-500', CHECK_OUT: 'bg-purple-500', GUARDIA_FINALIZADA: 'bg-indigo-400',
        HANDOVER: 'bg-emerald-400', PRESENTE: 'bg-emerald-400',
        MARK_ABSENT: 'bg-rose-500', AUSENTE: 'bg-rose-500', ATTENDANCE: 'bg-amber-500',
        COVERAGE: 'bg-orange-500', COBERTURA_RELEVO: 'bg-orange-500',
        INTERRUPT: 'bg-red-600', BAJA_SERVICIO: 'bg-red-600',
        RETENCION: 'bg-orange-400', EXTENSION_TURNO: 'bg-orange-400',
        CONVOCATORIA_RETEN: 'bg-orange-500', ADELANTO_TURNO: 'bg-orange-300',
        FRANCO_TRABAJADO: 'bg-sky-400', WORKED_FRANCO: 'bg-sky-400',
        REPORT_PLANNING: 'bg-slate-500', LLEGADA_TARDE: 'bg-amber-400',
    };
    const OPS_ACTIONS = new Set(['CHECKIN','CHECKOUT','MARK_ABSENT','HANDOVER','INTERRUPT','COVERAGE','WORKED_FRANCO','ATTENDANCE','REPORT_PLANNING','REPORTE','RETENCION','PRESENTE','AUSENTE','SALIDA','ENTRADA','CHECK_IN','CHECK_OUT','MANUAL_ATTENDANCE','VACANCY','LLEGADA_TARDE','ADELANTO_TURNO','CONVOCATORIA_RETEN','FRANCO_TRABAJADO','BAJA_SERVICIO','INTERCAMBIO_TURNO','GUARDIA_INICIADA','GUARDIA_FINALIZADA','COBERTURA_RELEVO','EXTENSION_TURNO']);
    const filteredBitacora = useMemo(() => {
        let logs = logic.recentLogs.filter((l: any) => {
            if (l.formattedActor === 'VACANTE') return false;
            const mod = String(l.module || '').toUpperCase();
            if (mod === 'REPORTES' || mod === 'LIQUIDACION') return false;
            const a = String(l.action || '').toUpperCase();
            if (a.includes('LIQUIDACION') || a === 'EXPORT_REPORT') return false;
            return true;
        });
        if (bitacoraFiltroGuardia && session.mySession?.startTime) {
            const guardStart = session.mySession.startTime.getTime();
            logs = logs.filter((l: any) => l.time && l.time.getTime() >= guardStart);
        }
        if (bitacoraFiltroObj) {
            logs = logs.filter((l: any) => l.objectiveId === bitacoraFiltroObj || l.objectiveName === bitacoraFiltroObj);
        }
        if (bitacoraFiltroTipo) {
            logs = logs.filter((l: any) => {
                const a = (l.action || '').toUpperCase();
                if (bitacoraFiltroTipo === 'ingresos') return a.includes('CHECK') || a === 'HANDOVER' || a === 'PRESENTE' || a === 'ENTRADA';
                if (bitacoraFiltroTipo === 'ausencias') return a.includes('ABSENT') || a === 'AUSENTE' || a === 'ATTENDANCE';
                if (bitacoraFiltroTipo === 'coberturas') return a.includes('COVERAGE') || a === 'RETENCION' || a === 'CONVOCATORIA_RETEN' || a === 'FRANCO_TRABAJADO' || a === 'ADELANTO_TURNO';
                if (bitacoraFiltroTipo === 'sistema') return a.includes('GUARDIA') || a === 'REPORT_PLANNING' || a === 'VACANCY';
                return true;
            });
        }
        if (bitacoraTab === 'reciente') return logs.slice(0, 50);
        return logs.filter((l: any) => {
            const a = (l.action || '').toUpperCase();
            return OPS_ACTIONS.has(a) || a.includes('CHECK') || a.includes('GUARD') || a.includes('TURNO') || a.includes('SHIFT') || a.includes('ABSENT') || a.includes('HANDOVER') || a.includes('COVERAGE') || a.includes('FRANCO') || a.includes('INTERRUPT');
        });
    }, [logic.recentLogs, bitacoraTab, bitacoraFiltroGuardia, bitacoraFiltroObj, bitacoraFiltroTipo, session.mySession]);

    const mapWindowRef = useRef<Window | null>(null);
    const mapViewChannelRef = useRef<BroadcastChannel | null>(null);
    // BroadcastChannel: detectar map-view abierto en otra pestaña/ventana
    useEffect(() => {
        if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
        const ch = new BroadcastChannel('crono_mapview_sync');
        mapViewChannelRef.current = ch;
        ch.onmessage = (e) => {
            if (e.data?.type === 'MAPVIEW_OPEN' || e.data?.type === 'MAPVIEW_HEARTBEAT') {
                setIsExternalMap(true);
            } else if (e.data?.type === 'MAPVIEW_CLOSED') {
                setIsExternalMap(false);
                mapWindowRef.current = null;
            }
        };
        return () => { ch.close(); mapViewChannelRef.current = null; };
    }, []);
    const handleUndockMap = () => {
        if (mapWindowRef.current && !mapWindowRef.current.closed) {
            mapWindowRef.current.focus();
            return;
        }
        const win = window.open('/admin/operaciones/map-view', 'CronoMapTactical', 'width=1400,height=900,menubar=no,toolbar=no,location=no,status=no');
        if (win) {
            mapWindowRef.current = win;
            setIsExternalMap(true);
            const check = setInterval(() => {
                if (win.closed) {
                    clearInterval(check);
                    setIsExternalMap(false);
                    mapWindowRef.current = null;
                }
            }, 1000);
        }
    };
    const handleRestoreMap = () => {
        // Enviar cierre a map-view vía BroadcastChannel
        mapViewChannelRef.current?.postMessage({ type: 'MAPVIEW_CLOSE_REQUEST' });
        // Si era popup, cerrarlo directamente
        if (mapWindowRef.current && !mapWindowRef.current.closed) mapWindowRef.current.close();
        mapWindowRef.current = null;
        setIsExternalMap(false);
    };
    const generateDailyReport = () => {
        const pdf = new jsPDF();
        const now = new Date();
        const tz  = 'America/Argentina/Cordoba';
        const fmt24 = (d: any) => { try { return toDate(d).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', hour12: false, timeZone: tz }); } catch { return '--:--'; } };
        const fmtDT = (d: Date) => d.toLocaleString('es-AR', { timeZone: tz, day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12: false });
        const fmtDateLong = (d: Date) => d.toLocaleDateString('es-AR', { timeZone: tz, weekday:'long', day:'2-digit', month:'long', year:'numeric' });
        // Fix double-encoded UTF-8 (e.g. Ã³ → ó)
        const fixEnc = (s: string) => { try { return decodeURIComponent(escape(s || '')); } catch { return s || ''; } };
        // Sanitize: keep printable latin-1, fix encoding first
        const sanitize = (s: string) => fixEnc(s).replace(/[^\x20-\xFF]/g, '').replace(/\s+/g, ' ').trim();
        const operatorName = session.activeSession?.operatorName || session.mySession?.operatorName || 'Sistema Automatico';
        const guardStart   = session.activeSession?.startTime ? fmtDT(session.activeSession.startTime)
                           : session.mySession?.startTime    ? fmtDT(session.mySession.startTime) : 'No registrado';
        const reportTime   = fmtDT(now);
        const empresaNombre = empresa?.name || empresaId || 'Centro de Operaciones';
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();

        const sectionHeader = (title: string, r: number, g: number, b: number) => {
            pdf.addPage();
            pdf.setFillColor(r, g, b);
            pdf.rect(0, 0, pageW, 18, 'F');
            pdf.setTextColor(255, 255, 255);
            pdf.setFontSize(13); pdf.setFont('helvetica', 'bold');
            pdf.text(title, 14, 12);
            pdf.setTextColor(0, 0, 0);
            return 26;
        };

        // ── Datos base ──────────────────────────────────────────────────────
        const todayShifts    = logic.processedData.filter((s: any) => isSameDay(s.shiftDateObj, now));
        const completedToday = todayShifts.filter((s: any) => s.isCompleted || s.status === 'COMPLETED');
        const activeNow      = todayShifts.filter((s: any) => s.isPresent && !s.isCompleted);
        const retainedNow    = todayShifts.filter((s: any) => s.isRetention);
        const vacantToday    = todayShifts.filter((s: any) => s.isUnassigned);
        const absentToday    = todayShifts.filter((s: any) => s.isAbsent || s.isPotentialAbsence);
        const distinctObjs   = new Set(todayShifts.map((s:any)=>s.objectiveId).filter(Boolean));
        const coveredObjs    = new Set(todayShifts.filter((s:any)=>s.isPresent||s.isCompleted).map((s:any)=>s.objectiveId).filter(Boolean));
        const totalPlanHrs   = todayShifts.filter((s:any)=>!s.isUnassigned).reduce((a:number,s:any)=>{ try{ return a+Math.max(0,(toDate(s.endDateObj).getTime()-toDate(s.shiftDateObj).getTime())/3600000); }catch{return a;} },0);
        const totalRealHrs   = completedToday.reduce((a:number,s:any)=>{ const rs=s.realStartTime?.seconds?new Date(s.realStartTime.seconds*1000):null; const re=s.realEndTime?.seconds?new Date(s.realEndTime.seconds*1000):null; if(rs&&re){const h=(re.getTime()-rs.getTime())/3600000; return h>0&&h<=36?a+h:a;} return a; },0);
        // Denominador: turnos operativos del día (excl. vacantes, francos y virtuales)
        const operationalShifts = todayShifts.filter((s:any) => !s.isUnassigned && !s.isFranco && !s.isVirtual);
        const plannedShifts  = operationalShifts.length;
        const totalOpShifts  = plannedShifts || (logic.stats.plan + logic.stats.activos + logic.stats.retenidos + logic.stats.vacantes + logic.stats.ausentes);
        // DEBUG audit — ver en consola del navegador al generar el PDF
        console.group('[PDF] Auditoría turnos planificados');
        console.log('Total todayShifts:', todayShifts.length, '| Sin asignar:', vacantToday.length, '| Francos:', todayShifts.filter((s:any)=>s.isFranco).length, '| Virtuales:', todayShifts.filter((s:any)=>s.isVirtual).length, '| OPERACIONALES:', plannedShifts);
        operationalShifts.forEach((s:any) => console.log(' -', s.employeeName||'?', '|', s.objectiveName||s.objectiveId||'?', '|', s.positionName||'?', '| status:', s.status||'?', '| isPresent:', s.isPresent, '| isCompleted:', s.isCompleted, '| isAbsent:', s.isAbsent));
        console.groupEnd();
        const coveredShifts  = completedToday.length + activeNow.length + retainedNow.length;
        const coveragePct    = totalOpShifts > 0 ? Math.min(100, Math.round((coveredShifts / totalOpShifts) * 100)) : 0;
        const punctualCount  = completedToday.filter((s:any)=>{ const rs=s.realStartTime?.seconds?new Date(s.realStartTime.seconds*1000):null; if(!rs)return true; return (rs.getTime()-toDate(s.shiftDateObj).getTime())/60000<=5; }).length;
        const punctualPct    = completedToday.length > 0 ? Math.round((punctualCount/completedToday.length)*100) : 100;
        const hasIncidents   = (absentToday.length + vacantToday.length) > 0;
        const statusLabel    = hasIncidents ? 'CON INCIDENCIAS' : 'NORMAL';

        // ── Alertas deduplicadas ─────────────────────────────────────────────
        const noiseTypes = new Set(['RECARGO_12H','RETENCION_DETECTADA','RETENCION_LARGA','RETENCIÓN','RETENCION']);
        const todayIso = now.toLocaleDateString('en-CA', {timeZone: tz}); // YYYY-MM-DD
        const todayStartMs = new Date(todayIso + 'T00:00:00-03:00').getTime();
        const alertsToday  = empNovedades.filter((n:any) => {
            if (n.type === 'VACANTE_A_PLANIFICACION') return false;
            const tsMs = n.createdAt?.seconds ? n.createdAt.seconds * 1000 : 0;
            return tsMs >= todayStartMs - 3*3600000; // incluir desde 21hs día anterior
        });
        const seenAlertKeys = new Set<string>();
        const dedupedAlerts = alertsToday.filter((n: any) => {
            const tsMin = n.createdAt?.seconds ? Math.floor(n.createdAt.seconds / 300) : 0;
            // Para alertas de ruido (recargo, retencion): dedup por tipo+empleado+ventana 30min
            const winKey = noiseTypes.has(n.type)
                ? `${n.type}|${n.employeeId||n.employeeName||''}|${Math.floor(tsMin/6)}`
                : `${n.type}|${n.objectiveId||''}|${n.positionName||''}|${n.employeeId||''}|${tsMin}`;
            if (seenAlertKeys.has(winKey)) return false;
            seenAlertKeys.add(winKey);
            return true;
        });
        const pendingNovedades  = dedupedAlerts.filter((n:any)=>n.status!=='ATENDIDA'&&n.status!=='atendida');

        // ── Logs PDF ─────────────────────────────────────────────────────────
        const pdfOpsLogs = logic.recentLogs.filter((l: any) => {
            if (l.formattedActor === 'VACANTE') return false;
            const a = (l.action || '').toUpperCase();
            return OPS_ACTIONS.has(a) || a.includes('CHECK') || a.includes('GUARD') || a.includes('TURNO') || a.includes('SHIFT') || a.includes('ABSENT') || a.includes('HANDOVER') || a.includes('COVERAGE') || a.includes('FRANCO') || a.includes('INTERRUPT');
        });

        // ── Por objetivo ─────────────────────────────────────────────────────
        const objMap = new Map<string,any>();
        todayShifts.forEach((s:any) => {
            if (!s.objectiveId) return;
            if (!objMap.has(s.objectiveId)) objMap.set(s.objectiveId,{name:s.objectiveName||s.objectiveId,plan:0,activo:0,compl:0,ausente:0,vacante:0,ret:0,planHrs:0,realHrs:0,tardanzas:0});
            const o = objMap.get(s.objectiveId);
            o.plan++;
            if (s.isPresent && !s.isCompleted) o.activo++;
            if (s.isCompleted) o.compl++;
            if (s.isAbsent || s.isPotentialAbsence) o.ausente++;
            if (s.isUnassigned) o.vacante++;
            if (s.isRetention) o.ret++;
            try { const ph=(toDate(s.endDateObj).getTime()-toDate(s.shiftDateObj).getTime())/3600000; if(ph>0&&ph<=24)o.planHrs+=ph; } catch {}
            if (s.isCompleted) {
                const rs=s.realStartTime?.seconds?new Date(s.realStartTime.seconds*1000):null;
                const re=s.realEndTime?.seconds?new Date(s.realEndTime.seconds*1000):null;
                if(rs&&re){const h=(re.getTime()-rs.getTime())/3600000; if(h>0&&h<=36)o.realHrs+=h;}
                const planS=toDate(s.shiftDateObj);
                if(rs&&(rs.getTime()-planS.getTime())/60000>5)o.tardanzas++;
            }
        });

        // ═══════════════════════════════════════════════════════════════════════
        // PÁGINA 1 — PORTADA
        // ═══════════════════════════════════════════════════════════════════════
        pdf.setFillColor(15, 23, 42);
        pdf.rect(0, 0, pageW, pageH * 0.42, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(28); pdf.setFont('helvetica', 'bold');
        pdf.text('INFORME DE GUARDIA', pageW / 2, 46, { align: 'center' });
        pdf.setFontSize(13); pdf.setFont('helvetica', 'normal');
        pdf.text(sanitize(empresaNombre), pageW / 2, 58, { align: 'center' });
        pdf.setFontSize(10);
        pdf.text(fmtDateLong(now).toUpperCase(), pageW / 2, 72, { align: 'center' });
        const badgeColor: [number,number,number] = hasIncidents ? [220,38,38] : [5,150,105];
        pdf.setFillColor(...badgeColor);
        pdf.roundedRect(pageW/2 - 32, 80, 64, 11, 2, 2, 'F');
        pdf.setFontSize(9); pdf.setFont('helvetica', 'bold');
        pdf.text(statusLabel, pageW / 2, 87.5, { align: 'center' });

        // KPI cards en portada
        pdf.setTextColor(0, 0, 0);
        const cardY = pageH * 0.42 + 10;
        const cards = [
            { label: 'COBERTURA', value: `${coveragePct}%`, color: coveragePct>=90?[5,150,105]:coveragePct>=75?[217,119,6]:[220,38,38] as [number,number,number] },
            { label: 'ACTIVOS', value: String(logic.stats.activos), color: [30,64,175] as [number,number,number] },
            { label: 'AUSENCIAS', value: String(absentToday.length), color: absentToday.length>0?[220,38,38]:[100,116,139] as [number,number,number] },
            { label: 'VACANTES', value: String(logic.stats.vacantes), color: logic.stats.vacantes>0?[220,38,38]:[100,116,139] as [number,number,number] },
            { label: 'RETENCIONES', value: String(logic.stats.retenidos + retainedNow.length), color: [124,58,237] as [number,number,number] },
            { label: 'ALERTAS PEND.', value: String(pendingNovedades.length), color: pendingNovedades.length>0?[220,38,38]:[100,116,139] as [number,number,number] },
        ];
        const cardW = (pageW - 28) / 3;
        cards.forEach((c, i) => {
            const cx = 14 + (i % 3) * (cardW + 4);
            const cy = cardY + Math.floor(i / 3) * 28;
            pdf.setFillColor(248, 250, 252);
            pdf.setDrawColor(226, 232, 240);
            pdf.roundedRect(cx, cy, cardW, 24, 2, 2, 'FD');
            pdf.setFillColor(...c.color as [number,number,number]);
            pdf.roundedRect(cx, cy, 4, 24, 1, 1, 'F');
            pdf.setFontSize(16); pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(...c.color as [number,number,number]);
            pdf.text(c.value, cx + cardW/2, cy + 13, { align: 'center' });
            pdf.setFontSize(7); pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(100, 116, 139);
            pdf.text(c.label, cx + cardW/2, cy + 20, { align: 'center' });
        });

        // Fila de metadata
        const metaY = cardY + 60;
        pdf.setFontSize(9); pdf.setTextColor(0,0,0);
        const col1 = 14, col2 = pageW / 2 + 6;
        pdf.setFont('helvetica', 'bold'); pdf.text('OPERADOR:', col1, metaY);
        pdf.setFont('helvetica', 'normal'); pdf.text(sanitize(operatorName), col1 + 27, metaY);
        pdf.setFont('helvetica', 'bold'); pdf.text('INICIO GUARDIA:', col1, metaY + 8);
        pdf.setFont('helvetica', 'normal'); pdf.text(sanitize(guardStart), col1 + 37, metaY + 8);
        pdf.setFont('helvetica', 'bold'); pdf.text('CIERRE / REPORTE:', col1, metaY + 16);
        pdf.setFont('helvetica', 'normal'); pdf.text(sanitize(reportTime), col1 + 41, metaY + 16);
        pdf.setFont('helvetica', 'bold'); pdf.text('TURNOS CUBIERTOS:', col2, metaY);
        pdf.setFont('helvetica', 'normal'); pdf.text(`${coveredShifts} / ${totalOpShifts} (${coveragePct}%)`, col2 + 44, metaY);
        pdf.setFont('helvetica', 'bold'); pdf.text('HORAS PLANIFICADAS:', col2, metaY + 8);
        pdf.setFont('helvetica', 'normal'); pdf.text(`${totalPlanHrs.toFixed(1)} hs`, col2 + 46, metaY + 8);
        pdf.setFont('helvetica', 'bold'); pdf.text('HORAS EJECUTADAS:', col2, metaY + 16);
        pdf.setFont('helvetica', 'normal'); pdf.text(`${totalRealHrs.toFixed(1)} hs (turnos completados)`, col2 + 43, metaY + 16);

        // ═══════════════════════════════════════════════════════════════════════
        // PÁGINA 2 — RESUMEN EJECUTIVO
        // ═══════════════════════════════════════════════════════════════════════
        const y2 = sectionHeader('RESUMEN EJECUTIVO', 30, 64, 175);
        autoTable(pdf, {
            head: [['INDICADOR', 'VALOR', 'INDICADOR', 'VALOR']],
            body: [
                ['Turnos planificados hoy', String(totalOpShifts),       'Guardias presentes',        String(logic.stats.activos)],
                ['Turnos completados',       String(completedToday.length),'Retenciones activas',      String(logic.stats.retenidos)],
                ['Vacantes sin cubrir',      String(logic.stats.vacantes), 'Ausencias registradas',    String(absentToday.length)],
                ['Objetivos con cobertura',  `${coveredObjs.size} / ${distinctObjs.size}`,'% Turnos cubiertos',`${coveragePct}%`],
                ['Horas planificadas',       `${totalPlanHrs.toFixed(1)} hs`,'Horas ejecutadas (compl.)',`${totalRealHrs.toFixed(1)} hs`],
                ['Indice de puntualidad',    `${punctualPct}%`,            'Alertas registradas',      String(dedupedAlerts.length)],
                ['Alertas pendientes',       String(pendingNovedades.length),'Estado de guardia',       statusLabel],
            ],
            startY: y2,
            styles: { fontSize: 9, cellPadding: 4 },
            headStyles: { fillColor: [30, 64, 175], fontStyle: 'bold' },
            columnStyles: {
                0:{fillColor:[241,245,249],textColor:[71,85,105],fontStyle:'bold'},
                1:{fontStyle:'bold',textColor:[15,23,42]},
                2:{fillColor:[241,245,249],textColor:[71,85,105],fontStyle:'bold'},
                3:{fontStyle:'bold',textColor:[15,23,42]},
            },
            theme: 'grid',
            didParseCell: (data: any) => {
                if (data.section==='body' && data.column.index===3) {
                    const v = String(data.cell.raw);
                    if (v===statusLabel && hasIncidents) { data.cell.styles.textColor=[220,38,38]; data.cell.styles.fontStyle='bold'; }
                    if (v.endsWith('%') && parseInt(v)<80 && v!==`${punctualPct}%`) data.cell.styles.textColor=[220,38,38];
                }
                if (data.section==='body' && data.column.index===1) {
                    const v = String(data.cell.raw);
                    if (['Vacantes sin cubrir','Ausencias registradas','Alertas pendientes'].some((_,i)=>data.row.index===[2,2,6][i] && parseInt(v)>0))
                        data.cell.styles.textColor=[220,38,38];
                }
            },
        });

        // ═══════════════════════════════════════════════════════════════════════
        // PÁGINA 3 — COBERTURA POR OBJETIVO
        // ═══════════════════════════════════════════════════════════════════════
        const y3 = sectionHeader('COBERTURA POR OBJETIVO', 30, 64, 175);
        const objRows = Array.from(objMap.values()).map((o:any) => {
            const sla = o.plan > 0 ? Math.round(((o.activo+o.compl) / o.plan)*100) : 0;
            return [
                sanitize(o.name),
                String(o.plan),
                String(o.activo),
                String(o.compl),
                String(o.ausente),
                String(o.vacante),
                String(o.ret),
                `${o.planHrs.toFixed(1)}h`,
                `${sla}%`,
            ];
        });
        autoTable(pdf, {
            head: [['Objetivo','Plan','Activos','Compl.','Ausentes','Vacantes','Ret.','Hs Plan','SLA%']],
            body: objRows.length>0 ? objRows : [['Sin datos','—','—','—','—','—','—','—','—']],
            startY: y3,
            styles: { fontSize: 8.5 },
            headStyles: { fillColor: [30,64,175] },
            columnStyles: { 0:{cellWidth:55}, 8:{fontStyle:'bold'} },
            didParseCell: (data:any) => {
                if (data.section==='body') {
                    const col = data.column.index;
                    const v = parseInt(String(data.cell.raw));
                    if ((col===4||col===5) && v>0) { data.cell.styles.textColor=[220,38,38]; data.cell.styles.fontStyle='bold'; }
                    if (col===8) {
                        const pct = parseInt(String(data.cell.raw));
                        if (pct>=90) data.cell.styles.textColor=[5,150,105];
                        else if (pct>=75) data.cell.styles.textColor=[217,119,6];
                        else data.cell.styles.textColor=[220,38,38];
                    }
                }
            },
        });

        // ═══════════════════════════════════════════════════════════════════════
        // PÁGINA 4 — INCIDENCIAS
        // ═══════════════════════════════════════════════════════════════════════
        const y4 = sectionHeader('INCIDENCIAS DEL TURNO', 153, 27, 27);
        let incY = y4;

        // Tardanzas
        const tardanzasRows = completedToday
            .filter((s:any) => { const rs=s.realStartTime?.seconds?new Date(s.realStartTime.seconds*1000):null; if(!rs)return false; return (rs.getTime()-toDate(s.shiftDateObj).getTime())/60000>5; })
            .map((s:any) => {
                const rs=new Date(s.realStartTime.seconds*1000);
                const lm=Math.round((rs.getTime()-toDate(s.shiftDateObj).getTime())/60000);
                return [sanitize(s.employeeName||'-'),sanitize(s.objectiveName||'-'),sanitize(s.positionName||'-'),fmt24(s.shiftDateObj),`+${lm} min`];
            });
        pdf.setFontSize(10); pdf.setFont('helvetica','bold'); pdf.setTextColor(217,119,6);
        pdf.text(`TARDANZAS (${tardanzasRows.length})`, 14, incY);
        incY += 4;
        autoTable(pdf, {
            head: [['Guardia','Objetivo','Posicion','Horario plan','Demora']],
            body: tardanzasRows.length>0 ? tardanzasRows : [['—','Sin tardanzas registradas','—','—','—']],
            startY: incY,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [217,119,6] },
            margin: { top: 0 },
        });
        incY = (pdf as any).lastAutoTable.finalY + 8;

        // Ausencias
        const ausenciasRows = absentToday.map((s:any) => [
            sanitize(s.employeeName||'(sin nombre)'),
            sanitize(s.objectiveName||'-'),
            sanitize(s.positionName||'-'),
            fmt24(s.shiftDateObj),
            s.isAbsent ? 'AUSENTE' : 'NO LLEGO',
        ]);
        pdf.setFontSize(10); pdf.setFont('helvetica','bold'); pdf.setTextColor(220,38,38);
        pdf.text(`AUSENCIAS (${ausenciasRows.length})`, 14, incY);
        incY += 4;
        autoTable(pdf, {
            head: [['Guardia','Objetivo','Posicion','Horario plan','Estado']],
            body: ausenciasRows.length>0 ? ausenciasRows : [['—','Sin ausencias','—','—','—']],
            startY: incY,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [220,38,38] },
            margin: { top: 0 },
        });
        incY = (pdf as any).lastAutoTable.finalY + 8;

        // Retenciones activas
        const retRows = [...retainedNow, ...activeNow.filter((s:any)=>s.manualRetentionType)].map((s:any) => {
            const retType = s.manualRetentionType==='open' ? 'INDETERMINADA' : s.manualRetentionHours ? `+${s.manualRetentionHours}h` : 'RETENCION';
            const since = s.activeStartTime?.seconds ? new Date(s.activeStartTime.seconds*1000) : null;
            const mins = since ? Math.round((now.getTime()-since.getTime())/60000) : 0;
            return [sanitize(s.employeeName||'-'),sanitize(s.objectiveName||'-'),sanitize(s.positionName||'-'),`${Math.floor(mins/60)}h ${mins%60}m`,retType];
        });
        if (retRows.length > 0 || logic.stats.retenidos > 0) {
            pdf.setFontSize(10); pdf.setFont('helvetica','bold'); pdf.setTextColor(124,58,237);
            pdf.text(`RETENCIONES ACTIVAS (${retRows.length})`, 14, incY);
            incY += 4;
            autoTable(pdf, {
                head: [['Guardia','Objetivo','Posicion','Tiempo retenido','Tipo']],
                body: retRows.length>0 ? retRows : [['—','Sin retenciones activas','—','—','—']],
                startY: incY,
                styles: { fontSize: 8 },
                headStyles: { fillColor: [124,58,237] },
                margin: { top: 0 },
            });
        }

        // ═══════════════════════════════════════════════════════════════════════
        // VACANTES SIN CUBRIR (incluye SIN COBERTURA auto-declaradas)
        // ═══════════════════════════════════════════════════════════════════════
        incY = (pdf as any).lastAutoTable?.finalY ? (pdf as any).lastAutoTable.finalY + 8 : incY + 8;
        const vacantNormal  = vacantToday.filter((s: any) => !s.isSinCobertura);
        const vacantSinCob  = vacantToday.filter((s: any) => s.isSinCobertura);
        const allVacantRows = [
            ...vacantSinCob.map((s: any) => [
                'SIN COBERTURA',
                sanitize(s.objectiveName || '-'),
                sanitize(s.positionName || '-'),
                `${fmt24(s.shiftDateObj)} - ${fmt24(s.endDateObj)}`,
                sanitize(s.vacancyOrigin === 'ABSENCE' ? 'Ausencia' : 'Sin planif.'),
            ]),
            ...vacantNormal.map((s: any) => [
                sanitize(s.isReportedToPlanning ? 'DEVUELTA' : 'SIN CUBRIR'),
                sanitize(s.objectiveName || '-'),
                sanitize(s.positionName || '-'),
                `${fmt24(s.shiftDateObj)} - ${fmt24(s.endDateObj)}`,
                sanitize(s.vacancyOrigin || '-'),
            ]),
        ];
        pdf.setFontSize(10); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(220, 38, 38);
        pdf.text(`VACANTES SIN CUBRIR (${allVacantRows.length})`, 14, incY);
        incY += 4;
        autoTable(pdf, {
            head: [['Estado', 'Objetivo', 'Posicion', 'Horario', 'Origen']],
            body: allVacantRows.length > 0 ? allVacantRows : [['—', 'Sin vacantes sin cubrir', '—', '—', '—']],
            startY: incY,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [220, 38, 38] },
            margin: { top: 0 },
            didParseCell: (data: any) => {
                if (data.section === 'body' && data.column.index === 0) {
                    if (String(data.cell.raw) === 'SIN COBERTURA') {
                        data.cell.styles.textColor = [71, 85, 105];
                        data.cell.styles.fontStyle = 'bold';
                    } else if (String(data.cell.raw) === 'SIN CUBRIR') {
                        data.cell.styles.textColor = [220, 38, 38];
                        data.cell.styles.fontStyle = 'bold';
                    }
                }
            },
        });

        // ═══════════════════════════════════════════════════════════════════════
        // PÁGINA 5 — TURNOS COMPLETADOS
        // ═══════════════════════════════════════════════════════════════════════
        const y5 = sectionHeader('TURNOS COMPLETADOS', 5, 150, 105);
        const completedRows = completedToday
            .sort((a:any,b:any) => toDate(a.shiftDateObj).getTime()-toDate(b.shiftDateObj).getTime())
            .map((s: any) => {
                const planS  = toDate(s.shiftDateObj);
                const planE  = toDate(s.endDateObj);
                const realS  = s.realStartTime?.seconds ? new Date(s.realStartTime.seconds*1000) : null;
                const realE  = s.realEndTime?.seconds   ? new Date(s.realEndTime.seconds*1000)   : null;
                const planHr = ((planE.getTime()-planS.getTime())/3600000).toFixed(1);
                const realHr = (realS&&realE) ? ((realE.getTime()-realS.getTime())/3600000).toFixed(1) : '-';
                const lateMin = realS ? Math.round((realS.getTime()-planS.getTime())/60000) : 0;
                const punct   = lateMin > 5 ? `TARDE +${lateMin}m` : 'A TIEMPO';
                return [sanitize(s.employeeName||'-'), sanitize(s.objectiveName||'-'), sanitize(s.positionName||'-'),
                    `${fmt24(planS)} - ${fmt24(planE)}`, `${planHr}h`, `${realHr}h`, punct];
            });
        autoTable(pdf, {
            head: [['Guardia','Objetivo','Posicion','Horario Plan.','Hs Plan','Hs Real','Puntualidad']],
            body: completedRows.length>0 ? completedRows : [['','Sin turnos completados','','','','','']],
            startY: y5,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [5,150,105] },
            didParseCell: (data:any) => {
                if (data.column.index===6 && String(data.cell.raw).startsWith('TARDE')) {
                    data.cell.styles.textColor=[217,119,6]; data.cell.styles.fontStyle='bold';
                }
            },
        });

        // ═══════════════════════════════════════════════════════════════════════
        // PÁGINA 6 — BITÁCORA DE OPERACIONES
        // ═══════════════════════════════════════════════════════════════════════
        const y6 = sectionHeader('BITACORA DE OPERACIONES', 15, 23, 42);
        // Dedup bitácora: mismo actor+evento+objetivo en ventana 1 min
        const seenLogKeys = new Set<string>();
        const dedupedLogs = pdfOpsLogs.filter((log:any) => {
            const tsMin = log.time?.seconds ? Math.floor(log.time.seconds/60) : 0;
            const key = `${(log.action||'').toUpperCase()}|${log.formattedActor||''}|${log.targetEmployee||''}|${tsMin}`;
            if (seenLogKeys.has(key)) return false;
            seenLogKeys.add(key);
            return true;
        });
        const logRows = dedupedLogs.map((log:any) => [
            fmt24(log.time),
            sanitize((log.action||'LOG').replace('MANUAL_','')),
            sanitize(log.formattedActor||'Sistema'),
            sanitize(log.targetEmployee||'-'),
            sanitize(log.fullDetail||log.details||'-'),
        ]);
        autoTable(pdf, {
            head: [['Hora','Evento','Operador','Guardia / Objetivo','Detalle']],
            body: logRows.length>0 ? logRows : [['','','','','Sin eventos registrados']],
            startY: y6,
            styles: { fontSize: 7.5 },
            headStyles: { fillColor: [15,23,42] },
            columnStyles: { 4: { cellWidth: 65 } },
        });

        // ═══════════════════════════════════════════════════════════════════════
        // PÁGINA 7 — TRATAMIENTO DE ALERTAS
        // ═══════════════════════════════════════════════════════════════════════
        const y7 = sectionHeader('TRATAMIENTO DE ALERTAS', 153, 27, 27);
        // Resumen al inicio
        pdf.setFontSize(9); pdf.setFont('helvetica','normal'); pdf.setTextColor(0,0,0);
        pdf.text(`Total: ${dedupedAlerts.length} alertas  |  Pendientes: ${pendingNovedades.length}  |  Atendidas: ${dedupedAlerts.length-pendingNovedades.length}`, 14, y7-6);
        const alertTypeLabel = (t:string) => ({
            AUSENCIA_AUTO:'AUSENCIA', VACANTE_PROTOCOLO_COBERTURA:'PROT. COBERTURA',
            VACANTE_A_PLANIFICACION:'VACANTE PLAN', RELEVO_NO_PRESENTADO:'RELEVO',
            VACANTE_NO_CUBIERTA:'SIN CUBRIR', BAJA_CUBIERTA:'BAJA CUBIERTA',
            RETENCION_LARGA:'RETENCION', POSICION_SIN_RELEVO:'SIN RELEVO', RELEVO_INMINENTE:'RELEVO',
            RECARGO_12H:'RECARGO 12H', LLEGADA_TARDE:'TARDANZA', RETENCION:'RETENCION',
            RETENCION_DETECTADA:'RETENCION', RETENCIÓN:'RETENCION',
        } as any)[t] || t;
        const pendientesAlerts = dedupedAlerts.filter((n:any)=>n.status!=='ATENDIDA'&&n.status!=='atendida');
        const atendidasAlerts  = dedupedAlerts.filter((n:any)=>n.status==='ATENDIDA'||n.status==='atendida');
        const alertRows = [...pendientesAlerts, ...atendidasAlerts].map((n:any) => {
            const ts = n.createdAt?.seconds ? new Date(n.createdAt.seconds*1000).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:tz}) : '--';
            const st = (n.status==='ATENDIDA'||n.status==='atendida') ? 'ATENDIDA' : 'PENDIENTE';
            return [ts, alertTypeLabel(n.type), sanitize(n.objectiveName||'-'), sanitize(n.positionName||'-'), sanitize(n.description||'-'), st];
        });
        autoTable(pdf, {
            head: [['Hora','Tipo','Objetivo','Posicion','Descripcion','Estado']],
            body: alertRows.length>0 ? alertRows : [['','','','','Sin alertas registradas','']],
            startY: y7,
            styles: { fontSize: 7.5 },
            headStyles: { fillColor: [153,27,27] },
            columnStyles: { 4:{cellWidth:60}, 5:{cellWidth:22} },
            didParseCell: (data:any) => {
                if (data.column.index===5 && data.cell.raw==='PENDIENTE') {
                    data.cell.styles.textColor=[220,38,38]; data.cell.styles.fontStyle='bold';
                }
            },
        });

        // Pie de página
        const totalPages = (pdf as any).internal.getNumberOfPages();
        for (let i=1; i<=totalPages; i++) {
            pdf.setPage(i);
            pdf.setFontSize(7); pdf.setFont('helvetica','normal'); pdf.setTextColor(150,150,150);
            pdf.text(`Informe confidencial - ${sanitize(operatorName)} - ${reportTime}`, 14, pageH-6);
            pdf.text(`Pagina ${i} / ${totalPages}`, pageW-14, pageH-6, { align:'right' });
        }
        pdf.save(`guardia_${now.toLocaleDateString('es-AR',{timeZone:tz}).replace(/\//g,'-')}.pdf`);
    };
    const handleOpenWA = (shift: any) => {
        setWaData({ isOpen: true, ctx: { employeeName: shift.employeeName || '', phone: shift.phone || '', objectiveName: shift.objectiveName, horaInicio: formatTimeSimple(shift.shiftDateObj), horaFin: formatTimeSimple(shift.endDateObj) } });
    };
    const handleMarkAbsent = async (shift: any) => {
        try {
            const shiftDate = shift.shiftDateObj instanceof Date ? shift.shiftDateObj : new Date(shift.shiftDateObj);
            const dayStart  = new Date(shiftDate); dayStart.setHours(0,0,0,0);
            const dayEnd    = new Date(shiftDate); dayEnd.setHours(23,59,59,999);
            const shiftEmpresaId = String(shift.empresaId || empresaId || '').trim();

            // Si ya fue marcado automáticamente (AA), evitar doble registro en ausencias
            const alreadyAutoAbsent = shift.isAbsent === true && shift.absenceType === 'AA';

            // 1. Marcar el turno como ausente (confirma la ausencia con origen operador)
            await updateDocForEmpresa('turnos', shift.id, {
                status:       'ABSENT',
                isAbsent:     true,
                absenceType:  alreadyAutoAbsent ? 'AA' : 'MANUAL_OPS',
                absenceConfirmedBy: 'OPERACIONES',
                absenceConfirmedAt: serverTimestamp(),
            }, empresaId, migracionCompleta);

            // 2. Crear registro en ausencias SOLO si no fue creado automáticamente
            if (!alreadyAutoAbsent) {
                await addDoc(collection(db, 'ausencias'), stampEmpresaId({
                    employeeId:     shift.employeeId,
                    employeeName:   shift.employeeName,
                    clientId:       shift.clientId   || null,
                    type:           'NO_PRESENTACION',   // tipo correcto: no presentación
                    startDate:      Timestamp.fromDate(dayStart),
                    endDate:        Timestamp.fromDate(dayEnd),
                    status:         'Pendiente',
                    reason:         `No presentación en turno — ${shift.objectiveName} (${shift.positionName})`,
                    hasCertificate: false,
                    createdAt:      serverTimestamp(),
                    origin:         'OPERACIONES',
                    shiftId:        shift.id,
                }, shiftEmpresaId));
            }

            // 3. Notificar a RRHH y Planificación vía novedades
            await addDoc(collection(db, 'novedades'), stampEmpresaId({
                type:         'AUSENCIA_OPERATIVA',
                title:        'Ausencia confirmada desde Operaciones',
                status:       'pending',
                employeeId:   shift.employeeId,
                employeeName: shift.employeeName,
                clientId:     shift.clientId   || null,
                objectiveId:  shift.objectiveId || null,
                shiftId:      shift.id,
                description:  `${shift.employeeName} no se presentó en ${shift.objectiveName} — ${shift.positionName} (${new Date(shiftDate).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'})})${alreadyAutoAbsent ? ' [ya detectado automáticamente]' : ''}`,
                createdAt:    serverTimestamp(),
                reportedBy:   'OPERACIONES',
            }, shiftEmpresaId));

            setAttendanceData({isOpen:false, shift:null});
            setCoverageData({isOpen:true, shift: shift});
            const msg = alreadyAutoAbsent
                ? `Ausencia de ${shift.employeeName} confirmada (ya detectada automáticamente).`
                : `Ausencia de ${shift.employeeName} registrada. Notificado a RRHH y Planificación.`;
            // Bitácora
            {
                const _actor = getAuth().currentUser?.displayName || getAuth().currentUser?.email?.split('@')[0] || 'Operador';
                addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                    action: 'MARK_ABSENT', module: 'OPERACIONES', actorName: _actor,
                    timestamp: serverTimestamp(), employeeId: shift.employeeId,
                    employeeName: shift.employeeName, objectiveId: shift.objectiveId,
                    objectiveName: shift.objectiveName, shiftId: shift.id,
                    details: `${shift.employeeName} marcado ausente en ${shift.objectiveName || ''}.`,
                }, String(shift.empresaId || empresaId || '').trim())).catch(() => {});
            }
            toast.success(msg);
        } catch (e: any) {
            toast.error('Error al marcar ausencia: ' + (e?.message || e?.code || String(e)));
        }
    };
    const handleVacancyCreated = (newVacancyShift: any) => { setInterruptData({isOpen:false, shift:null}); setCoverageData({isOpen:true, shift: newVacancyShift}); };

    // Revertir ausencia incorrecta (bug sistema o error del operador)
    const handleRevertAbsence = async (shift: any) => {
        if (!confirm(`Â¿Revertir la ausencia de ${shift.employeeName}?\nSe limpiará el flag de ausencia. Usá esto solo si fue un error.`)) return;
        try {
            await updateDocForEmpresa('turnos', shift.id, {
                isAbsent:          false,
                absenceType:       null,
                absenceDetectedAt: null,
                absenceDetectedBy: null,
                status:            'PENDING',
                absenceRevertedAt: serverTimestamp(),
                absenceRevertedBy: 'OPERACIONES',
            }, empresaId, migracionCompleta);
            toast.success(`Ausencia de ${shift.employeeName} revertida.`);
        } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
    };
    const handleDeclareAbsentT5 = async (shift: any) => {
        const shiftEmpresaId = String(shift.empresaId || empresaId || '').trim();
        const shiftDate = shift.shiftDateObj instanceof Date ? shift.shiftDateObj : new Date(shift.shiftDateObj);
        const dayStart = new Date(shiftDate); dayStart.setHours(0,0,0,0);
        const dayEnd   = new Date(shiftDate); dayEnd.setHours(23,59,59,999);
        await updateDocForEmpresa('turnos', shift.id, {
            status: 'ABSENT', isAbsent: true,
            absenceType: 'MANUAL_OPS',
            absenceConfirmedBy: 'OPERACIONES',
            absenceConfirmedAt: serverTimestamp(),
        }, empresaId, migracionCompleta);
        await addDoc(collection(db, 'ausencias'), stampEmpresaId({
            employeeId: shift.employeeId, employeeName: shift.employeeName,
            clientId: shift.clientId || null, type: 'NO_PRESENTACION',
            startDate: Timestamp.fromDate(dayStart), endDate: Timestamp.fromDate(dayEnd),
            status: 'Pendiente',
            reason: `No presentación en turno — ${shift.objectiveName} (${shift.positionName})`,
            hasCertificate: false, createdAt: serverTimestamp(),
            origin: 'OPERACIONES', shiftId: shift.id,
        }, shiftEmpresaId));
        if (shift.employeeId) {
            await addDoc(collection(db, 'user_notifications'), stampEmpresaId({
                userId: shift.employeeId, type: 'AUSENCIA_DECLARADA',
                title: 'Ausencia registrada',
                read: false,
                body: `Tu ausencia en ${shift.objectiveName} fue registrada por Operaciones.`,
                objectiveId: shift.objectiveId, shiftId: shift.id, createdAt: serverTimestamp(),
            }, shiftEmpresaId));
        }
        await addDoc(collection(db, 'novedades'), stampEmpresaId({
            type: 'AUSENCIA_OPERATIVA', title: 'Ausencia declarada T+5',
            status: 'pending', employeeId: shift.employeeId, employeeName: shift.employeeName,
            clientId: shift.clientId || null, objectiveId: shift.objectiveId || null,
            shiftId: shift.id, objectiveName: shift.objectiveName || '',
            positionName: shift.positionName || '',
            description: `${shift.employeeName} no se presentó en ${shift.objectiveName} — ${shift.positionName} (${formatTimeRange(shift.shiftDateObj, shift.endDateObj)})`,
            createdAt: serverTimestamp(), reportedBy: 'OPERACIONES',
        }, shiftEmpresaId));
        setCoverageData({ isOpen: true, shift });
        toast.success(`Ausencia de ${shift.employeeName} registrada. Iniciando protocolo de cobertura.`);
    };
    const handleLateArrival = async (shift: any, etaTime: string) => {
        try {
            await updateDocForEmpresa('turnos', shift.id, {
                lateArrivalAt: serverTimestamp(),
                lateETA: etaTime,
            }, empresaId, migracionCompleta);
            toast.info(`Llegada tarde de ${shift.employeeName} registrada. ETA: ${etaTime}`);
        } catch (e: any) {
            toast.error('Error: ' + (e?.message || String(e)));
        }
    };
    const handleNovedadAbsence = async (shift: any) => {
        if (!confirm(`Â¿Registrar aviso anticipado de ausencia para ${shift.employeeName}?\nSe notificará a RRHH y Planificación.`)) return;
        try {
            const batch = writeBatch(db);
            // Marca el turno con aviso → el planificador muestra barra ámbar
            if (shift.id && !shift.isVirtual) {
                batch.update(doc(db, 'turnos', shift.id), {
                    plannedNovedad:     'AVISO',
                    notifiedAbsent:     true,         // protege al turno del AA automático a T+30
                    notifiedAbsentAt:   serverTimestamp(),
                });
            }
            await batch.commit();
            // Abrir inmediatamente el protocolo de cobertura — no esperar T+30
            setCoverageData({ isOpen: true, shift });
            await addDoc(collection(db, 'novedades'), stampEmpresaId({
                type: 'AVISO_AUSENCIA_ANTICIPADA',
                title: 'Aviso anticipado de ausencia',
                status: 'pending',
                employeeId: shift.employeeId,
                employeeName: shift.employeeName,
                clientId: shift.clientId || null,
                objectiveId: shift.objectiveId || null,
                objectiveName: shift.objectiveName || '',
                positionName: shift.positionName || '',
                shiftId: shift.id,
                description: `${shift.employeeName} avisó que no se presentará al turno en ${shift.objectiveName} (${shift.positionName}) — ${formatTimeRange(shift.shiftDateObj, shift.endDateObj)}.`,
                createdAt: serverTimestamp(),
                reportedBy: 'OPERACIONES',
            }, String(shift.empresaId || empresaId || '').trim()));
            toast.info(`Aviso de ausencia de ${shift.employeeName} registrado. Notificado a Planificación.`);
        } catch (e: any) {
            toast.error('Error al registrar novedad: ' + (e?.message || e?.code || String(e)));
        }
    };
    const handleCierreGuardia = async () => {
        if (!session.mySession) return;
        setCierreLoading(true);
        try {
            const guardStart = session.mySession.startTime;
            const now = new Date();
            const logsDeGuardia = logic.recentLogs.filter((l: any) => l.time && l.time.getTime() >= guardStart.getTime());
            const resumen = {
                ingresos: logsDeGuardia.filter((l:any) => ['CHECKIN','CHECK_IN','HANDOVER','PRESENTE'].includes((l.action||'').toUpperCase())).length,
                salidas: logsDeGuardia.filter((l:any) => ['CHECKOUT','CHECK_OUT'].includes((l.action||'').toUpperCase())).length,
                ausencias: logsDeGuardia.filter((l:any) => ['MARK_ABSENT','AUSENTE','ATTENDANCE'].includes((l.action||'').toUpperCase())).length,
                coberturas: logsDeGuardia.filter((l:any) => ['COVERAGE','COBERTURA_RELEVO'].includes((l.action||'').toUpperCase())).length,
                retenes: logsDeGuardia.filter((l:any) => ['CONVOCATORIA_RETEN','ADELANTO_TURNO','FRANCO_TRABAJADO'].includes((l.action||'').toUpperCase())).length,
                bajas: logsDeGuardia.filter((l:any) => ['INTERRUPT','BAJA_SERVICIO'].includes((l.action||'').toUpperCase())).length,
            };
            const { addDoc: _addDoc, collection: col } = await import('firebase/firestore');
            await _addDoc(col(db, 'informes_guardia'), stampEmpresaId({
                operatorId: session.mySession.operatorId,
                operatorName: session.mySession.operatorName || getAuth().currentUser?.displayName || 'Operador',
                guardiaStart: Timestamp.fromDate(guardStart),
                guardiaEnd: Timestamp.fromDate(now),
                observaciones: cierreObs,
                resumen,
                totalEventos: logsDeGuardia.length,
                novedadesPendientes: pendingNovedades.length,
                createdAt: serverTimestamp(),
            }, String(empresaId).trim()));
            await addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                action: 'GUARDIA_CERRADA',
                module: 'OPERACIONES',
                actorName: session.mySession.operatorName || getAuth().currentUser?.displayName || 'Operador',
                timestamp: serverTimestamp(),
                details: `Cierre de guardia. ${resumen.ingresos} ingresos, ${resumen.ausencias} ausencias, ${resumen.coberturas} coberturas. Novedades pendientes: ${pendingNovedades.length}.`,
            }, String(empresaId).trim()));
            toast.success('Informe de cierre guardado');
            setCierreGuardiaOpen(false);
            setCierreObs('');
        } catch(e: any) {
            toast.error('Error al guardar informe: ' + (e?.message || String(e)));
        } finally {
            setCierreLoading(false);
        }
    };
    const handleReportPlanning = async (shift: any) => {
        // Vacantes por ausencia no se devuelven a planificación
        if (shift.vacancyOrigin === 'ABSENCE') {
            toast.error('Las vacantes por ausencia no se devuelven a planificación. Cubrirlas desde el tab VACANTES.');
            return;
        }
        try {
            let targetId = shift.id;
            if (shift.isVirtual || shift.id.startsWith('SLA_GAP') || shift.id.startsWith('V124_')) {
                // Vacante virtual: no existe en Firestore, crear documento real
                const newRef = doc(collection(db, 'turnos'));
                targetId = newRef.id;
                const newShiftData: any = stampEmpresaId({
                    clientId: shift.clientId, clientName: shift.clientName,
                    objectiveId: shift.objectiveId, objectiveName: shift.objectiveName,
                    positionName: shift.positionName,
                    employeeId: 'VACANTE', employeeName: 'VACANTE',
                    // Fix 4: asegurar que el Date sea correcto antes de convertir a Timestamp
                    // shiftDateObj es un Date local de Argentina — Timestamp.fromDate lo convierte a UTC correctamente
                    startTime: Timestamp.fromDate(shift.shiftDateObj instanceof Date ? shift.shiftDateObj : new Date(shift.shiftDateObj)),
                    endTime:   Timestamp.fromDate(shift.endDateObj   instanceof Date ? shift.endDateObj   : new Date(shift.endDateObj)),
                    status: 'REPORTED_TO_PLANNING', isReported: true, isReportedToPlanning: true,
                    comments: 'Vacante de Contrato Reportada',
                    createdAt: serverTimestamp(), origin: 'SLA_VIRTUAL',
                }, String(shift.empresaId || empresaId || '').trim());
                await setDoc(newRef, newShiftData);
            } else {
                await updateDoc(doc(db, 'turnos', targetId), { status: 'REPORTED_TO_PLANNING', isReported: true, isReportedToPlanning: true });
            }
            await addDoc(collection(db, 'novedades'), stampEmpresaId({
                type: 'VACANTE_NO_CUBIERTA', title: 'Vacante Sin Cubrir',
                status: 'pending',
                clientId: shift.clientId, objectiveId: shift.objectiveId, shiftId: targetId,
                objectiveName: shift.objectiveName || '',
                positionName: shift.positionName || '',
                description: `Sin cubrir: ${shift.positionName || '—'} en ${shift.objectiveName}${shift.shiftDateObj ? ' · ' + formatTimeRange(shift.shiftDateObj, shift.endDateObj) : ''}`,
                createdAt: serverTimestamp(), reportedBy: 'OPERACIONES'
            }, String(shift.empresaId || empresaId || '').trim()));
            toast.success('Reporte enviado correctamente');
        } catch (e: any) {
            console.error('[operaciones] handleReportPlanning error:', e);
            toast.error('Error al reportar: ' + (e?.message || e?.code || String(e)));
        }
    };

    // --- AUTO-TAB: si hay ausentes/vacantes al cargar, ir directo al tab urgente ---
    const autoTabDoneRef = useRef(false);
    useEffect(() => {
        if (autoTabDoneRef.current) return;
        const total = logic.stats.plan + logic.stats.activos + logic.stats.retenidos + logic.stats.vacantes + logic.stats.ausentes;
        if (total === 0) return; // datos aún no cargaron
        autoTabDoneRef.current = true;
        if (logic.stats.ausentes > 0 && (logic.viewTab === 'PRIORIDAD' || logic.viewTab === 'PLAN')) {
            logic.setViewTab('AUSENTES' as any);
            // Compact automático si hay muchos ausentes
            if (logic.stats.ausentes > 4 && !logic.isCompact) logic.setIsCompact(true);
        } else if (logic.stats.vacantes > 0 && logic.stats.ausentes === 0 && (logic.viewTab === 'PRIORIDAD' || logic.viewTab === 'PLAN')) {
            logic.setViewTab('VACANTES' as any);
            if (logic.stats.vacantes > 4 && !logic.isCompact) logic.setIsCompact(true);
        }
    }, [logic.stats.ausentes, logic.stats.vacantes, logic.stats.plan]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // â"€â"€ COBERTURA POR OBJETIVO â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    const coverageByObjective = useMemo(() => {
        const now = new Date();
        const map: Record<string, {name:string; client:string; total:number; active:number; absent:number; vacant:number; objectiveId:string}> = {};
        const hoy = logic.processedData.filter((s:any) =>
            isSameDay(s.shiftDateObj, now) || ((s.isPresent || s.isRetention) && !s.isCompleted)
        );
        hoy.forEach((s:any) => {
            if (isEventShift(s)) return;
            if (s.isFranco) return;
            const key = s.objectiveId || 'unknown';
            if (!map[key]) map[key] = { name: s.objectiveName || '—', client: s.clientName || '', total: 0, active: 0, absent: 0, vacant: 0, objectiveId: key };
            map[key].total++;
            if (s.isPresent || s.isRetention) map[key].active++;
            if (s.isAbsent || s.isPotentialAbsence) map[key].absent++;
            if (s.isUnassigned) map[key].vacant++;
        });
        return Object.values(map)
            .filter(o => o.total > 0)
            .sort((a, b) => (b.absent + b.vacant) - (a.absent + a.vacant));
    }, [logic.processedData]);

    const groupedList = useMemo(() => {
        if (!isGrouped) return [];
        const groups: Record<string, any> = {};
        logic.listData.forEach((s: any) => { const k = s.objectiveId || 'unknown'; if (!groups[k]) groups[k] = { id: k, name: s.objectiveName || 'Sin Objetivo', client: s.clientName || 'Cliente', items: [] }; groups[k].items.push(s); });
        return Object.values(groups).sort((a: any, b: any) => {
            const cmp = (a.client || '').localeCompare(b.client || '');
            return cmp !== 0 ? cmp : (a.name || '').localeCompare(b.name || '');
        });
    }, [logic.listData, isGrouped]);

    const matchesViewTabForShift = (s: any) => {
        switch(logic.viewTab) {
            case 'ACTIVOS':    return s.isPresent && !s.isCompleted && !s.isRetention;
            case 'RETENIDOS':  return s.isRetention;
            case 'AUSENTES':   return s.isAbsent || s.isPotentialAbsence;
            case 'VACANTES':   return s.isUnassigned;
            case 'PLAN':       return s.isFuture && !s.isFranco && !s.isUnassigned;
            case 'FRANCOS':    return s.isFranco;
            default:           return !s.isFranco;
        }
    };

    // â"€â"€ VISTA POR OBJETIVO: estado agregado por objetivo, ordenado por criticidad â"€â"€
    const objectivesWithAlerts = useMemo(() => {
        const now = new Date();
        const map = new Map<string, any>();
        const hoy = logic.processedData.filter((s: any) => {
            if (s.isCompleted && !s.isRetention) return false;
            if (s.isVirtual && s.endDateObj && !isSameDay(s.shiftDateObj, now) && s.endDateObj.getTime() < now.getTime()) return false;
            return isSameDay(s.shiftDateObj, now) || ((s.isPresent || s.isRetention) && !s.isCompleted);
        });
        hoy.forEach((s: any) => {
            if (isEventShift(s)) return;
            if (s.isFranco) return;
            const key = s.objectiveId || 'unknown';
            if (!map.has(key)) {
                map.set(key, {
                    objectiveId: key,
                    name:    s.objectiveName  || '—',
                    client:  s.clientName     || '',
                    clientId: s.clientId      || '',
                    lat: s.lat, lng: s.lng,
                    active: 0, absent: 0, vacant: 0, retention: 0, plan: 0, total: 0,
                    criticalShift: null as any,  // el más urgente para abrir cobertura directo
                    shifts: [] as any[],
                });
            }
            const obj = map.get(key)!;
            obj.total++;
            obj.shifts.push(s);
            if (s.isRetention)                               obj.retention++;
            else if (s.isPresent && !s.isCompleted)          obj.active++;
            else if (s.isAbsent || s.isPotentialAbsence)   { obj.absent++;  if (!obj.criticalShift) obj.criticalShift = s; }
            else if (s.isUnassigned)                       { obj.vacant++;  if (!obj.criticalShift) obj.criticalShift = s; } // incluye devueltas
            else if (s.isFuture || s.isImminent)             obj.plan++;
        });
        // Aplicar filtro de cliente si está activo
        const clientFilter = logic.selectedClientId;
        return Array.from(map.values())
            .filter(o => !clientFilter || o.clientId === clientFilter)
            .sort((a, b) => {
                // Criticidad: ausentes > vacantes > retención > ok
                const scoreA = a.absent * 3 + a.vacant * 2 + a.retention;
                const scoreB = b.absent * 3 + b.vacant * 2 + b.retention;
                return scoreB - scoreA;
            })
            // Excluir objetivos sin actividad real (evita mostrar cronogramas no publicados)
            .filter(o => (o.active + o.absent + o.vacant + o.retention + o.plan) > 0);
    }, [logic.processedData, logic.selectedClientId]);

    const eventsWithAlerts = useMemo(() => {
        const now = new Date();
        const map = new Map<string, any>();
        const hoy = logic.processedData.filter((s: any) => {
            if (s.isCompleted && !s.isRetention) return false;
            if (s.isVirtual && s.endDateObj && !isSameDay(s.shiftDateObj, now) && s.endDateObj.getTime() < now.getTime()) return false;
            return isSameDay(s.shiftDateObj, now) || ((s.isPresent || s.isRetention) && !s.isCompleted);
        });
        hoy.forEach((s: any) => {
            if (!isEventShift(s)) return;
            if (s.isFranco) return;
            const key = getEventGroupKey(s);
            if (!map.has(key)) {
                map.set(key, {
                    eventKey: key,
                    label: getEventGroupLabel(s),
                    objectiveName: s.objectiveName || '—',
                    client: s.clientName || '',
                    clientId: s.clientId || '',
                    active: 0, absent: 0, vacant: 0, retention: 0, plan: 0, total: 0,
                    criticalShift: null as any,
                    shifts: [] as any[],
                });
            }
            const ev = map.get(key)!;
            ev.total++;
            ev.shifts.push(s);
            if (s.isRetention)                              ev.retention++;
            else if (s.isPresent && !s.isCompleted)        ev.active++;
            else if (s.isAbsent || s.isPotentialAbsence) { ev.absent++; if (!ev.criticalShift) ev.criticalShift = s; }
            else if (s.isUnassigned)                      { ev.vacant++; if (!ev.criticalShift) ev.criticalShift = s; }
            else if (s.isFuture || s.isImminent)           ev.plan++;
        });
        const clientFilter = logic.selectedClientId;
        return Array.from(map.values())
            .filter(ev => !clientFilter || ev.clientId === clientFilter)
            .sort((a, b) => {
                const scoreA = a.absent * 3 + a.vacant * 2 + a.retention;
                const scoreB = b.absent * 3 + b.vacant * 2 + b.retention;
                return scoreB - scoreA;
            })
            .filter(ev => (ev.active + ev.absent + ev.vacant + ev.retention + ev.plan) > 0);
    }, [logic.processedData, logic.selectedClientId]);

    const modalSetters = { setCheckoutData, setAttendanceData, setHandoverData, setInterruptData, setCoverageData, setManualRetentionData };
    const tabs = [
        { id: 'PLAN',      label: 'PLAN',    count: logic.stats.plan,      color: 'text-indigo-600' },
        { id: 'ACTIVOS',   label: 'ACT',     count: logic.stats.activos,   color: 'text-emerald-600' },
        { id: 'RETENIDOS', label: 'RET',     count: logic.stats.retenidos, color: 'text-orange-600' },
        { id: 'VACANTES',  label: 'VAC',     count: logic.stats.vacantes,  color: 'text-slate-800' },
        { id: 'AUSENTES',  label: 'AUS',     count: logic.stats.ausentes,  color: 'text-rose-700' },
        { id: 'FRANCOS',   label: 'FRANC',   count: logic.stats.francos,   color: 'text-blue-600' }
    ];

    if (!(logic.isStable ?? logic.isReady)) return (
        <DashboardLayout>
            <Head><title>COSP V1.0 | Centro de Operaciones</title></Head>
            <div className="min-h-screen flex items-center justify-center select-none p-4">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-5 w-full max-w-xs">
                    <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                        <Radio size={28} className="text-cyan-400" style={{ animation: 'pulse 1.8s ease-in-out infinite' }}/>
                    </div>
                    <div className="text-center">
                        <p className="text-white text-lg font-black tracking-tight">Centro de Control</p>
                        <p className="text-slate-500 text-[10px] mt-0.5 font-medium uppercase tracking-widest">COSP Operaciones</p>
                    </div>
                    <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-500 rounded-full" style={{ animation: 'ccLoadBar 1.6s ease-in-out infinite alternate' }}/>
                    </div>
                    <p className="text-slate-500 text-xs font-medium">Sincronizando datos en tiempo real...</p>
                    <style>{`@keyframes ccLoadBar { from { width: 15%; } to { width: 85%; } }`}</style>
                </div>
            </div>
        </DashboardLayout>
    );

    return (
        <>
        <DashboardLayout>
            <Head><title>COSP V1.0 | Centro de Operaciones</title></Head>
            <style>{POPUP_STYLES}</style>
            {!centroControlEnabled && (
                <div className="mx-2 mt-2 mb-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-bold text-amber-800">
                        Centro de Control pausado: no se generan ausencias automáticas ni avisos. Activalo en Configuración → Empresas.
                    </p>
                </div>
            )}
            
            {/* â"€â"€ Banda Estado del Día â"€â"€ */}
            {(logic.stats.activos + logic.stats.plan + logic.stats.retenidos + logic.stats.vacantes + logic.stats.ausentes) > 0 && (() => {
                const total = logic.stats.plan + logic.stats.activos + logic.stats.retenidos + logic.stats.vacantes + logic.stats.ausentes;
                const cubiertos = logic.stats.activos + logic.stats.retenidos;
                // Solo sobre turnos que debieron iniciar (excluye los planificados para más tarde)
                const debieronIniciar = logic.stats.activos + logic.stats.retenidos + logic.stats.vacantes + logic.stats.ausentes;
                const cobertura = debieronIniciar > 0 ? Math.round((cubiertos / debieronIniciar) * 100) : total > 0 ? 0 : 100;
                const isCrisis  = cobertura < 50;
                const isWarning = cobertura >= 50 && cobertura < 80;
                const isOk      = cobertura >= 80;
                const barColor  = isOk ? 'bg-emerald-500' : isWarning ? 'bg-amber-500' : 'bg-rose-500';
                const pctColor  = isOk ? 'text-emerald-600' : isWarning ? 'text-amber-600' : 'text-rose-600';
                const bannerBg  = isCrisis ? 'bg-rose-50 border-rose-300' : isWarning ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200';
                return (
                    <div className={`mx-2 mb-2 border rounded-xl shadow-sm ${bannerBg}`}>
                        {/* Fila principal */}
                        <div className="px-3 py-2 flex flex-wrap items-center gap-2 sm:gap-4">
                            <div className="flex items-center gap-2">
                                {isCrisis && <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping inline-block shrink-0"/>}
                                <span className={`text-[10px] font-black uppercase tracking-wider shrink-0 ${isCrisis ? 'text-rose-600' : isWarning ? 'text-amber-600' : 'text-slate-400'}`}>
                                    {isCrisis ? 'âš  COBERTURA CRÍTICA' : isWarning ? '▲ ATENCIÓN' : 'Estado del día'}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 flex-1 min-w-[120px]">
                                <div className="shrink-0">
                                    <span className={`text-2xl font-black tabular-nums leading-none block ${pctColor}`}>{cobertura}%</span>
                                    {logic.stats.plan > 0 && (
                                        <span className="text-[8px] font-bold text-slate-400 leading-none whitespace-nowrap">
                                            +{logic.stats.plan} en espera
                                        </span>
                                    )}
                                </div>
                                <div className="flex-1 h-3 bg-white/70 border border-slate-200 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all duration-500 ${barColor} ${isCrisis ? 'animate-pulse' : ''}`} style={{ width: `${cobertura}%` }}/>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                                {[
                                    { label: 'Activos',  val: cubiertos,              cls: isOk ? 'text-emerald-600' : 'text-slate-500', bg: 'bg-emerald-50' },
                                    { label: 'Vacantes', val: logic.stats.vacantes,   cls: logic.stats.vacantes > 0 ? 'text-rose-600 font-black' : 'text-slate-400', bg: logic.stats.vacantes > 0 ? 'bg-rose-50' : 'bg-slate-50' },
                                    { label: 'Ausentes', val: logic.stats.ausentes,   cls: logic.stats.ausentes > 0 ? 'text-rose-700 font-black' : 'text-slate-400', bg: logic.stats.ausentes > 0 ? 'bg-rose-50' : 'bg-slate-50' },
                                    { label: 'Plan',     val: total,                  cls: 'text-slate-600', bg: 'bg-slate-50' },
                                ].map(m => (
                                    <div key={m.label} className={`text-center px-2 py-1 rounded-lg ${m.bg}`}>
                                        <div className={`text-base leading-none ${m.cls}`}>{m.val}</div>
                                        <div className="text-[8px] text-slate-400 uppercase mt-0.5 font-bold">{m.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* Barra de alertas rápidas cuando hay crisis */}
                        {isCrisis && (logic.stats.vacantes > 0 || logic.stats.ausentes > 0) && (
                            <div className="px-3 pb-2 flex gap-2 flex-wrap">
                                {logic.stats.ausentes > 0 && (
                                    <button onClick={() => logic.setViewTab('AUSENTES' as any)}
                                        className="flex items-center gap-1.5 px-3 py-2 lg:py-1 bg-rose-600 text-white text-xs lg:text-[10px] font-black rounded-lg hover:bg-rose-700 active:scale-95 transition-colors">
                                        <AlertTriangle size={13}/> {logic.stats.ausentes} AUSENTES — Gestionar
                                    </button>
                                )}
                                {logic.stats.vacantes > 0 && (
                                    <button onClick={() => logic.setViewTab('VACANTES' as any)}
                                        className="flex items-center gap-1.5 px-3 py-2 lg:py-1 bg-rose-100 text-rose-700 border border-rose-300 text-xs lg:text-[10px] font-black rounded-lg hover:bg-rose-200 active:scale-95 transition-colors">
                                        <UserX size={13}/> {logic.stats.vacantes} VACANTES — Ver
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* â"€â"€ GRID COBERTURA POR OBJETIVO (colapsable) â"€â"€ */}
            {coverageByObjective.length > 0 && (
                <div className="mx-2 mb-2">
                    <button onClick={() => setShowCoverageGrid(v => !v)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-xl shadow-sm hover:bg-slate-50 transition-colors text-left">
                        <Layers size={13} className="text-indigo-500 shrink-0"/>
                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-wider flex-1">Cobertura por objetivo</span>
                        <span className="text-[9px] text-slate-400">{coverageByObjective.length} objetivos</span>
                        <ChevronDown size={12} className={`text-slate-400 transition-transform ${showCoverageGrid ? 'rotate-180' : ''}`}/>
                    </button>
                    {showCoverageGrid && (
                        <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
                            {coverageByObjective.map(obj => {
                                const pct = obj.total > 0 ? Math.round((obj.active / obj.total) * 100) : 0;
                                const hasIssue = obj.absent > 0 || obj.vacant > 0;
                                const isCrit = pct < 50;
                                return (
                                    <div key={obj.objectiveId} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left ${isCrit ? 'bg-rose-50 border-rose-200' : hasIssue ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[10px] font-black truncate" style={{ color: isCrit ? '#dc2626' : hasIssue ? '#d97706' : '#1e293b' }}>{obj.name}</p>
                                            <p className="text-[9px] truncate" style={{ color: 'var(--txt3)' }}>{obj.client}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-[11px] font-black" style={{ color: isCrit ? '#dc2626' : hasIssue ? '#d97706' : '#10b981' }}>{pct}%</p>
                                            <p className="text-[9px]" style={{ color: 'var(--txt3)' }}>{obj.active}/{obj.total}</p>
                                        </div>
                                        {hasIssue && (
                                            <div className="text-[9px] shrink-0 text-right leading-tight">
                                                {obj.absent > 0 && <div className="text-rose-600 font-bold">{obj.absent}aus</div>}
                                                {obj.vacant > 0 && <div className="text-amber-600 font-bold">{obj.vacant}vac</div>}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            <div className={`flex flex-col lg:flex-row gap-2 lg:gap-4 p-2 animate-in fade-in relative ${mapCollapsed || isExternalMap ? 'h-[calc(100vh-164px)] lg:h-[calc(100vh-100px)]' : 'h-[calc(100vh-164px)] lg:h-[calc(100vh-100px)]'}`}>
                {!isExternalMap && !mapCollapsed && (
                    <div className="flex-1 max-h-[38%] lg:max-h-none lg:flex-[3] bg-slate-100 rounded-xl border border-slate-200 overflow-hidden relative shadow-inner">
                        <OperacionesMap
                            center={[-31.4201, -64.1888]}
                            allObjectives={logic.filteredObjectives}
                            filteredShifts={logic.listData}
                            onOpenCoverage={(s:any)=> { setCoverageData({isOpen:true, shift:s}); }}
                            onOpenCheckout={(s:any)=>setCheckoutData({isOpen:true, shift:s})}
                            onOpenAttendance={(s:any)=>setAttendanceData({isOpen:true, shift:s})}
                            onOpenHandover={(s:any)=>setHandoverData({isOpen:true, shift:s})}
                            onOpenInterrupt={(s:any)=>setInterruptData({isOpen:true, shift:s})}
                            onReportPlanning={handleReportPlanning}
                        />
                        <div className="absolute top-4 right-4 z-[1000] flex gap-2">
                            <button onClick={() => setMapCollapsed(true)} className="bg-white p-2 rounded-lg shadow hover:bg-slate-100" title="Colapsar mapa"><ChevronLeft size={18} className="text-slate-600"/></button>
                            <button onClick={handleUndockMap} className="hidden lg:flex bg-white p-2 rounded-lg shadow hover:bg-slate-100"><MonitorUp size={18} className="text-indigo-600"/></button>
                        </div>
                    </div>
                )}
                {!isExternalMap && mapCollapsed && (
                    <>
                        {/* Desktop: franja vertical */}
                        <button onClick={() => setMapCollapsed(false)}
                            className="hidden lg:flex items-center gap-2 w-10 bg-slate-100 rounded-xl border border-slate-200 shadow-inner hover:bg-slate-200 transition-colors writing-mode-vertical justify-center"
                            title="Expandir mapa">
                            <MapPin size={16} className="text-slate-400"/>
                            <span className="text-[9px] font-black text-slate-400 uppercase" style={{writingMode:'vertical-rl', transform:'rotate(180deg)'}}>Ver mapa</span>
                        </button>
                        {/* Mobile: botón flotante abajo a la derecha */}
                        <button onClick={() => setMapCollapsed(false)}
                            className="lg:hidden fixed bottom-6 right-4 z-50 flex items-center gap-2 px-4 py-3 bg-slate-800 text-white rounded-full shadow-xl hover:bg-slate-700 active:scale-95 transition-all"
                            title="Ver mapa">
                            <MapPin size={16}/>
                            <span className="text-xs font-black uppercase">Mapa</span>
                        </button>
                    </>
                )}

                <div className={`bg-white rounded-xl border border-slate-200 flex flex-col shadow-sm ${isExternalMap || mapCollapsed ? 'w-full' : 'flex-1 lg:flex-[2]'}`}>
                    <div className="px-3 pt-2 pb-2 border-b">
                        {/* Fila 1: título + controles */}
                        <div className="flex justify-between items-center mb-1.5">
                            <h2 className="text-sm font-black text-slate-800 flex items-center gap-1.5"><Radio className="text-rose-600 animate-pulse" size={13}/> Estado de Operaciones</h2>
                            <div className="flex items-center gap-1">
                                {/* Toggle OBJETIVOS / LISTA */}
                                <div className="flex p-0.5 bg-slate-100 rounded-lg gap-0.5">
                                    <button onClick={() => setViewMode('objetivos')}
                                        className={`px-2 py-1 text-[9px] font-black rounded-md transition-all flex items-center gap-0.5 ${viewMode === 'objetivos' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:bg-slate-200'}`}>
                                        <Building2 size={9}/> OBJ
                                    </button>
                                    <button onClick={() => setViewMode('lista')}
                                        className={`px-2 py-1 text-[9px] font-black rounded-md transition-all flex items-center gap-0.5 ${viewMode === 'lista' ? 'bg-white text-slate-700 shadow' : 'text-slate-400 hover:bg-slate-200'}`}>
                                        <Users size={9}/> LISTA
                                    </button>
                                </div>
                                {viewMode === 'lista' && <button onClick={() => setIsGrouped(!isGrouped)} className={`px-2 py-1 font-bold text-[9px] rounded-lg border flex items-center gap-1 transition-all ${isGrouped ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white text-slate-600 hover:bg-slate-50'}`}><Layers size={10}/>{isGrouped ? 'AGRUP.' : 'FLAT'}</button>}
                                {isExternalMap && <button onClick={handleRestoreMap} className="px-2 py-1 bg-indigo-50 text-indigo-700 font-bold text-[9px] rounded-lg border">Restaurar</button>}
                                {isSuperAdmin && <button onClick={() => setShowDebugPanel(true)} title="Panel de diagnóstico" className="px-2 py-1 bg-amber-50 text-amber-700 font-bold text-[9px] rounded-lg border border-amber-200 hover:bg-amber-100 transition-colors">🔍 Debug</button>}
                                <button onClick={() => logic.setIsCompact(!logic.isCompact)} aria-label={logic.isCompact ? 'Expandir panel' : 'Compactar panel'} className="p-1 bg-slate-100 rounded-lg text-slate-600">{logic.isCompact ? <Maximize2 size={12} aria-hidden="true"/> : <Minimize2 size={12} aria-hidden="true"/>}</button>
                            </div>
                        </div>

                        {/* Barra de sesión compacta */}
                        {session.isAutoMode ? (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-1.5 space-y-1">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"/>
                                        <span className="text-[10px] font-black text-amber-700 uppercase">
                                            {isCCOperator ? 'Iniciando guardiaâ€¦' : 'Modo Automático'}
                                        </span>
                                    </div>
                                    {/* Operadores CC: no muestran el botón — se auto-inicia */}
                                    {!isCCOperator && (
                                        <button onClick={session.startSession} className="px-2 py-1 bg-indigo-600 text-white text-[9px] font-black rounded-lg hover:bg-indigo-700">INICIAR GUARDIA</button>
                                    )}
                                </div>
                                {session.activeSessions.length > 0 && (
                                    <p className="text-[9px] text-amber-800 leading-tight">
                                        <span className="font-black">En guardia:</span>{' '}
                                        {session.activeSessions.map(s => s.operatorName).join(' · ')}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 mb-1.5 space-y-1">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"/>
                                        <span className="text-[10px] font-black text-slate-700 uppercase truncate max-w-[110px]">{session.mySession?.operatorName}</span>
                                        {elapsed && <span className="text-[9px] font-mono text-slate-500 bg-white px-1 py-0.5 rounded border">{elapsed}</span>}
                                        <span className="text-[9px] text-emerald-700 font-bold bg-emerald-100 px-1 rounded">TU GUARDIA</span>
                                    </div>
                                    {confirmEndSession ? (
                                        <div className="flex items-center gap-1 shrink-0">
                                            <span className="text-[8px] text-rose-600 font-black">Â¿Confirmar?</span>
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        await session.endSession();
                                                        toast.success('Sesión finalizada');
                                                        setConfirmEndSession(false);
                                                    } catch (e) {
                                                        console.error(e);
                                                        toast.error('No se pudo finalizar la sesión');
                                                    }
                                                }}
                                                className="px-1.5 py-1 bg-rose-600 text-white text-[8px] font-black rounded-lg hover:bg-rose-700"
                                            >Sí</button>
                                            <button onClick={() => setConfirmEndSession(false)} className="px-1.5 py-1 bg-slate-200 text-slate-700 text-[8px] font-black rounded-lg hover:bg-slate-300">No</button>
                                        </div>
                                    ) : (
                                        <button onClick={() => setConfirmEndSession(true)} className="px-2 py-1 bg-slate-700 text-white text-[9px] font-black rounded-lg hover:bg-slate-900 shrink-0">Finalizar Sesión</button>
                                    )}
                                </div>
                                {session.otherSessions.length > 0 && (
                                    <p className="text-[9px] text-emerald-800 leading-tight">
                                        <span className="font-black">También en guardia:</span>{' '}
                                        {session.otherSessions.map(s => s.operatorName).join(' · ')}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Búsqueda + cliente en una fila */}
                        <div className="flex gap-1.5 mb-1.5">
                            <select value={logic.selectedClientId} onChange={(e) => logic.setSelectedClientId(e.target.value)} className="flex-1 py-1 px-2 text-[10px] font-bold border border-slate-300 rounded-lg bg-slate-50 outline-none text-slate-700">
                                <option value="">TODOS LOS CLIENTES</option>
                                {logic.uniqueClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <div className="relative flex-1">
                                <Search className="absolute left-2 top-1.5 text-slate-400" size={12}/>
                                <input className="w-full bg-slate-50 border border-slate-200 pl-7 pr-2 py-1 rounded-lg text-[10px] font-bold uppercase outline-none focus:ring-1 focus:ring-indigo-500" placeholder="BUSCAR..." value={logic.filterText} onChange={(e) => logic.setFilterText(e.target.value)}/>
                            </div>
                        </div>

                        {/* UNA SOLA FILA: número grande + label abajo, clickable para filtrar */}
                        <div className="flex gap-0.5 overflow-x-auto">
                            {tabs.map(t => {
                                const isUrgent = (t.id === 'VACANTES' || t.id === 'AUSENTES') && t.count > 0;
                                const isActive = logic.viewTab === t.id;
                                return (
                                    <button key={t.id} onClick={() => logic.setViewTab(t.id as any)}
                                        className={`relative flex-1 px-1 py-2 lg:py-1.5 rounded-lg transition-all active:scale-95 whitespace-nowrap flex flex-col items-center gap-0
                                            ${isActive
                                                ? (isUrgent ? 'bg-rose-600 text-white shadow' : 'bg-slate-800 text-white shadow')
                                                : (isUrgent ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' : 'bg-slate-50 text-slate-400 hover:bg-slate-100')
                                            }`}>
                                        {isUrgent && !isActive && (
                                            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-rose-500 rounded-full animate-ping"/>
                                        )}
                                        <span className={`text-sm font-black leading-none ${isActive ? 'text-white' : isUrgent ? 'text-rose-600' : t.color}`}>
                                            {t.count || 0}
                                        </span>
                                        <span className={`text-[8px] font-black uppercase leading-none mt-0.5 ${isActive ? 'text-white/80' : 'text-slate-400'}`}>
                                            {t.label}
                                        </span>
                                    </button>
                                );
                            })}
                            {/* TOTAL — no clickable, solo info */}
                            <div className="flex-1 px-1 py-1.5 rounded-lg bg-slate-100 flex flex-col items-center gap-0">
                                <span className="text-sm font-black leading-none text-slate-600">
                                    {logic.stats.plan + logic.stats.activos + logic.stats.retenidos + logic.stats.vacantes + logic.stats.ausentes}
                                </span>
                                <span className="text-[8px] font-black uppercase leading-none mt-0.5 text-slate-400">TOT</span>
                            </div>
                        </div>
                    </div>

                    {/* â"€â"€ Panel ausencias autorizadas hoy â"€â"€ */}
                    {authorizedAbsences.length > 0 && (
                        <div className="px-3 py-1.5 border-b border-amber-100 bg-amber-50/60 shrink-0">
                            <button
                                onClick={() => setAbsencesPanelOpen(v => !v)}
                                className="flex items-center gap-1.5 w-full text-left"
                            >
                                <Calendar size={10} className="text-amber-600 shrink-0"/>
                                <span className="text-[9px] font-black text-amber-700 uppercase flex-1">Ausencias autorizadas hoy</span>
                                <span className="text-[9px] font-black bg-amber-500 text-white px-1.5 py-0.5 rounded-full">{authorizedAbsences.length}</span>
                                {absencesPanelOpen ? <ChevronUp size={10} className="text-amber-500 ml-1"/> : <ChevronDown size={10} className="text-amber-500 ml-1"/>}
                            </button>
                            {absencesPanelOpen && (
                                <div className="mt-1.5 space-y-1">
                                    {authorizedAbsences.map((a: any) => {
                                        const typeColors: Record<string, string> = {
                                            'Vacaciones': 'bg-teal-100 text-teal-700',
                                            'Enfermedad': 'bg-rose-100 text-rose-700',
                                            'ART': 'bg-orange-100 text-orange-700',
                                            'Licencia Esp.': 'bg-purple-100 text-purple-700',
                                            'Injustificada': 'bg-amber-100 text-amber-800',
                                            'PG Permiso Gremial': 'bg-blue-100 text-blue-700',
                                        };
                                        const typeColor = typeColors[a.type] || 'bg-slate-100 text-slate-600';
                                        const fmtD = (v: any) => {
                                            if (!v) return '--';
                                            if (typeof v === 'string') {
                                                const [y, m, d] = v.slice(0, 10).split('-');
                                                return `${d}/${m}`;
                                            }
                                            const dt = v.seconds ? new Date(v.seconds * 1000) : new Date(v);
                                            return dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
                                        };
                                        const typeShort = (a.type || 'AUS').slice(0, 3).toUpperCase();
                                        return (
                                            <div key={a.id} className="flex items-center gap-2 bg-white border border-amber-100 rounded-lg px-2 py-1">
                                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${typeColor}`}>{typeShort}</span>
                                                <span className="text-[10px] font-bold text-slate-700 flex-1 truncate">{a.employeeName || '—'}</span>
                                                <span className="text-[9px] text-slate-400 font-mono shrink-0">{fmtD(a.startDate)}→{fmtD(a.endDate)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto bg-slate-50">

                        {/* â•â• MODO OBJETIVOS (default) â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
                        {viewMode === 'objetivos' && (
                        <div className="p-2 space-y-1.5">
                            {(eventsWithAlerts.length === 0 && objectivesWithAlerts.length === 0) ? (
                                <div className="text-center py-10 text-slate-400 text-xs">Sin datos de objetivos</div>
                            ) : (
                                <>
                                    {eventsWithAlerts.map((ev) => {
                                        const pct = (ev.active + ev.retention) > 0 && ev.total > 0
                                            ? Math.round(((ev.active + ev.retention) / Math.max(ev.total - ev.plan, 1)) * 100)
                                            : ev.total > 0 ? 0 : 100;
                                        const isCrit = ev.absent > 0 || ev.vacant > 0;
                                        const isWarn = ev.retention > 0;
                                        const expandKey = `EVENT__${ev.eventKey}`;
                                        const isExpanded = expandedObjectiveId === expandKey;
                                        const borderColor = isCrit ? 'border-rose-300' : isWarn ? 'border-orange-300' : 'border-amber-300';
                                        const bgColor = isCrit ? 'bg-rose-50' : isWarn ? 'bg-orange-50/40' : 'bg-amber-50/40';
                                        const evShifts = (ev.shifts || []).filter((s: any) => matchesViewTabForShift(s));
                                        return (
                                            <div key={expandKey} className={`rounded-xl border ${borderColor} ${bgColor} overflow-hidden transition-all`}>
                                                <div className="px-3 py-3 lg:py-2.5 flex items-center gap-2">
                                                    <div className={`w-2.5 h-2.5 lg:w-2 lg:h-2 rounded-full shrink-0 ${isCrit ? 'bg-rose-500 animate-pulse' : isWarn ? 'bg-orange-500' : 'bg-amber-500'}`}/>
                                                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedObjectiveId(isExpanded ? null : expandKey)}>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-black text-slate-800 truncate">{ev.label}</span>
                                                            <span className="text-[9px] text-slate-400 shrink-0">{ev.client}</span>
                                                        </div>
                                                        <div className="flex items-center gap-3 mt-0.5">
                                                            <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden max-w-[80px]">
                                                                <div className="h-full rounded-full transition-all duration-500"
                                                                    style={{
                                                                        width: `${Math.min(100, pct)}%`,
                                                                        backgroundColor: isCrit ? '#ef4444' : isWarn ? '#f59e0b' : '#d97706'
                                                                    }}/>
                                                            </div>
                                                            <span className="text-[9px] font-black shrink-0" style={{color: isCrit ? '#dc2626' : isWarn ? '#d97706' : '#b45309'}}>
                                                                {pct}%
                                                            </span>
                                                            <div className="flex items-center gap-1">
                                                                {ev.active > 0 && <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 rounded">{ev.active} act</span>}
                                                                {ev.retention > 0 && <span className="text-[9px] font-bold text-orange-700 bg-orange-100 px-1.5 rounded animate-pulse">{ev.retention} ret</span>}
                                                                {ev.absent > 0 && <span className="text-[9px] font-bold text-rose-700 bg-rose-100 px-1.5 rounded">{ev.absent} aus</span>}
                                                                {ev.vacant > 0 && <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 rounded">{ev.vacant} vac</span>}
                                                                {ev.plan > 0 && <span className="text-[9px] text-slate-500 px-1">{ev.plan} plan</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        {(ev.absent > 0 || ev.vacant > 0) && ev.criticalShift && (
                                                            <button onClick={() => setCoverageData({isOpen:true, shift:ev.criticalShift})}
                                                                className="p-2 lg:p-1.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 active:scale-95 transition-colors"
                                                                title="Protocolo cobertura">
                                                                <Siren size={14}/>
                                                            </button>
                                                        )}
                                                        <button onClick={() => setExpandedObjectiveId(isExpanded ? null : expandKey)}
                                                            className="p-2 lg:p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors">
                                                            {isExpanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                                                        </button>
                                                    </div>
                                                </div>
                                                {isExpanded && (
                                                    <div className="border-t border-slate-200 bg-white px-2 py-2 space-y-1.5">
                                                        {evShifts.length === 0 ? (
                                                            <p className="text-[10px] text-slate-400 text-center py-2">Sin guardias en esta categoría</p>
                                                        ) : evShifts.map((s: any) => (
                                                            <GuardCard key={s.id} shift={s} viewTab={logic.viewTab} isCompact={true}
                                                                isAutoMode={session.isAutoMode}
                                                                onOpenCheckout={(s:any)=>setCheckoutData({isOpen:true, shift:s})}
                                                                onOpenAttendance={(s:any)=>setAttendanceData({isOpen:true, shift:s})}
                                                                onOpenHandover={(s:any)=>setHandoverData({isOpen:true, shift:s})}
                                                                onOpenInterrupt={(s:any)=>setInterruptData({isOpen:true, shift:s})}
                                                                onOpenCoverage={(s:any)=>setCoverageData({isOpen:true, shift:s})}
                                                                onReportPlanning={handleReportPlanning}
                                                                onOpenWorkedFranco={(s:any)=>setWorkedFrancoData({isOpen:true, shift:s})}
                                                                onNovedadAbsence={handleNovedadAbsence}
                                                                onOpenWA={handleOpenWA}
                                                                onOpenAbsenceDecision={(s:any)=>setAbsenceDecisionData({isOpen:true,shift:s})}
                                                                onOpenRRHH={(s:any)=>setRrhhVacancyData({isOpen:true,shift:s})}
                                                                onOpenManualRetention={(s:any)=>setManualRetentionData({isOpen:true,shift:s})}
                                                                onRevertAbsence={handleRevertAbsence}
                                                            />
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {objectivesWithAlerts.map(obj => {
                                const pct = (obj.active + obj.retention) > 0 && obj.total > 0
                                    ? Math.round(((obj.active + obj.retention) / Math.max(obj.total - obj.plan, 1)) * 100)
                                    : obj.total > 0 ? 0 : 100;
                                const isCrit = obj.absent > 0 || obj.vacant > 0;
                                const isWarn = obj.retention > 0;
                                const isExpanded = expandedObjectiveId === obj.objectiveId;
                                const borderColor = isCrit ? 'border-rose-300' : isWarn ? 'border-orange-300' : 'border-slate-200';
                                const bgColor = isCrit ? 'bg-rose-50' : isWarn ? 'bg-orange-50/40' : 'bg-white';

                                // OBJ expandido: filtra por tab activo (mismo comportamiento que stats/objectivesWithAlerts)
                                const now2 = new Date();
                                const objShifts = logic.processedData.filter((s: any) => {
                                    if (s.objectiveId !== obj.objectiveId) return false;
                                    if (isEventShift(s)) return false;
                                    // Mismo filtro "hoy" que stats — excluye completados y virtuales vencidos de OTRO día
                                    if (s.isCompleted && !s.isRetention) return false;
                                    if (s.isVirtual && s.endDateObj && !isSameDay(s.shiftDateObj, now2) && s.endDateObj.getTime() < now2.getTime()) return false;
                                    const hoy2 = isSameDay(s.shiftDateObj, now2) || ((s.isPresent || s.isRetention) && !s.isCompleted);
                                    if (!hoy2) return false;
                                    return matchesViewTabForShift(s);
                                });

                                return (
                                    <div key={obj.objectiveId} className={`rounded-xl border ${borderColor} ${bgColor} overflow-hidden transition-all`}>
                                        {/* Header del objetivo */}
                                        <div className="px-3 py-3 lg:py-2.5 flex items-center gap-2">
                                            {/* Indicador color */}
                                            <div className={`w-2.5 h-2.5 lg:w-2 lg:h-2 rounded-full shrink-0 ${isCrit ? 'bg-rose-500 animate-pulse' : isWarn ? 'bg-orange-500' : 'bg-emerald-500'}`}/>

                                            {/* Info principal — tappable para expandir */}
                                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedObjectiveId(isExpanded ? null : obj.objectiveId)}>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-black text-slate-800 truncate">{obj.name}</span>
                                                    <span className="text-[9px] text-slate-400 shrink-0">{obj.client}</span>
                                                </div>
                                                <div className="flex items-center gap-3 mt-0.5">
                                                    {/* Barra de cobertura */}
                                                    <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden max-w-[80px]">
                                                        <div className="h-full rounded-full transition-all duration-500"
                                                            style={{
                                                                width: `${Math.min(100, pct)}%`,
                                                                backgroundColor: isCrit ? '#ef4444' : isWarn ? '#f59e0b' : '#10b981'
                                                            }}/>
                                                    </div>
                                                    <span className="text-[9px] font-black shrink-0" style={{color: isCrit ? '#dc2626' : isWarn ? '#d97706' : '#10b981'}}>
                                                        {pct}%
                                                    </span>
                                                    {/* Badges de estado */}
                                                    <div className="flex items-center gap-1">
                                                        {obj.active > 0 && <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 rounded">{obj.active} act</span>}
                                                        {obj.retention > 0 && <span className="text-[9px] font-bold text-orange-700 bg-orange-100 px-1.5 rounded animate-pulse">{obj.retention} ret</span>}
                                                        {obj.absent > 0 && <span className="text-[9px] font-bold text-rose-700 bg-rose-100 px-1.5 rounded">{obj.absent} aus</span>}
                                                        {obj.vacant > 0 && <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 rounded">{obj.vacant} vac</span>}
                                                        {obj.plan > 0 && <span className="text-[9px] text-slate-500 px-1">{obj.plan} plan</span>}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Acciones rápidas */}
                                            <div className="flex items-center gap-1 shrink-0">
                                                {(obj.absent > 0 || obj.vacant > 0) && obj.criticalShift && (
                                                    <button onClick={() => setCoverageData({isOpen:true, shift:obj.criticalShift})}
                                                        className="p-2 lg:p-1.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 active:scale-95 transition-colors"
                                                        title="Protocolo cobertura">
                                                        <Siren size={14}/>
                                                    </button>
                                                )}
                                                <button onClick={() => setExpandedObjectiveId(isExpanded ? null : obj.objectiveId)}
                                                    className="p-2 lg:p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors">
                                                    {isExpanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Guardias expandidos */}
                                        {isExpanded && (
                                            <div className="border-t border-slate-200 bg-white px-2 py-2 space-y-1.5">
                                                {objShifts.length === 0 ? (
                                                    <p className="text-[10px] text-slate-400 text-center py-2">Sin guardias en esta categoría</p>
                                                ) : objShifts.map((s: any) => (
                                                    <GuardCard key={s.id} shift={s} viewTab={logic.viewTab} isCompact={true}
                                                        isAutoMode={session.isAutoMode}
                                                        onOpenCheckout={(s:any)=>setCheckoutData({isOpen:true, shift:s})}
                                                        onOpenAttendance={(s:any)=>setAttendanceData({isOpen:true, shift:s})}
                                                        onOpenHandover={(s:any)=>setHandoverData({isOpen:true, shift:s})}
                                                        onOpenInterrupt={(s:any)=>setInterruptData({isOpen:true, shift:s})}
                                                        onOpenCoverage={(s:any)=>setCoverageData({isOpen:true, shift:s})}
                                                        onReportPlanning={handleReportPlanning}
                                                        onOpenWorkedFranco={(s:any)=>setWorkedFrancoData({isOpen:true, shift:s})}
                                                        onNovedadAbsence={handleNovedadAbsence}
                                                        onOpenWA={handleOpenWA}
                                                        onOpenAbsenceDecision={(s:any)=>setAbsenceDecisionData({isOpen:true,shift:s})}
                                                        onOpenRRHH={(s:any)=>setRrhhVacancyData({isOpen:true,shift:s})}
                                                        onOpenManualRetention={(s:any)=>setManualRetentionData({isOpen:true,shift:s})}
                                                        onRevertAbsence={handleRevertAbsence}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                                </>
                            )}
                        </div>
                        )}

                        {/* â•â• MODO LISTA (existente) â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
                        {viewMode === 'lista' && (
                        <div className="p-3 space-y-2">
                        {logic.listData.length === 0 ? <div className="text-center py-10 text-slate-400 text-xs">Sin novedades en esta categoría</div> :
                            isGrouped ? (groupedList.map((group: any) => { const today = new Date(); const pubKey = `${group.id}_${today.getFullYear()}_${today.getMonth()+1}`; const isPublished = !!logic.publishStatusMap[pubKey]; return <ObjectiveGroup key={group.id} group={group} modals={modalSetters} isCompact={logic.isCompact} isAutoMode={session.isAutoMode} onReport={handleReportPlanning} viewTab={logic.viewTab} onOpenWorkedFranco={(s:any)=>setWorkedFrancoData({isOpen:true, shift:s})} onNovedadAbsence={handleNovedadAbsence} onOpenWA={handleOpenWA} onOpenAbsenceDecision={(s:any)=>setAbsenceDecisionData({isOpen:true,shift:s})} onOpenRRHH={(s:any)=>setRrhhVacancyData({isOpen:true,shift:s})} isPublished={isPublished}/>; })) :
                            (logic.listData.map((s:any) => <GuardCard key={s.id} shift={s} viewTab={logic.viewTab} isCompact={logic.isCompact} isAutoMode={session.isAutoMode} onOpenCheckout={(s:any)=>setCheckoutData({isOpen:true, shift:s})} onOpenAttendance={(s:any)=>setAttendanceData({isOpen:true, shift:s})} onOpenHandover={(s:any)=>setHandoverData({isOpen:true, shift:s})} onOpenInterrupt={(s:any)=>setInterruptData({isOpen:true, shift:s})} onOpenCoverage={(s:any)=> { setCoverageData({isOpen:true, shift:s}); }} onReportPlanning={handleReportPlanning} onOpenWorkedFranco={(s:any)=>setWorkedFrancoData({isOpen:true, shift:s})} onNovedadAbsence={handleNovedadAbsence} onOpenWA={handleOpenWA} onOpenAbsenceDecision={(s:any)=>setAbsenceDecisionData({isOpen:true,shift:s})} onOpenRRHH={(s:any)=>setRrhhVacancyData({isOpen:true,shift:s})} onOpenManualRetention={(s:any)=>setManualRetentionData({isOpen:true,shift:s})} onRevertAbsence={handleRevertAbsence}/>))
                        }
                        </div>
                        )}

                    </div>

                    {/* ── BITÁCORA collapsible ─────────────────────── */}
                    <div className={`border-t border-slate-200 bg-white flex flex-col shrink-0 transition-all duration-200 ${bitacoraOpen ? 'h-96' : ''}`}>
                      {/* Header */}
                      <div className="px-3 py-1.5 flex items-center gap-1.5 bg-slate-50 cursor-pointer select-none"
                           onClick={() => { setBitacoraOpen(v => { if (!v) bitacoraLastOpenRef.current = Date.now(); return !v; }); }}>
                        <ClipboardList size={12} className="text-slate-400 shrink-0"/>
                        <span className="text-[9px] font-black text-slate-500 uppercase flex-1">Bitácora</span>
                        {!bitacoraOpen && logic.recentLogs.filter((l:any)=>l.formattedActor!=='VACANTE').length > 0 && (
                          <span className="text-[9px] text-slate-400 mr-1">{logic.recentLogs.filter((l:any)=>l.formattedActor!=='VACANTE').length} eventos</span>
                        )}
                        {!bitacoraOpen && pendingNovedades.length > 0 && (
                          <span className="text-[9px] font-black bg-rose-500 text-white px-1.5 rounded-full animate-pulse mr-1">{pendingNovedades.length}</span>
                        )}
                        {bitacoraOpen ? <ChevronDown size={12} className="text-slate-400"/> : <ChevronRight size={12} className="text-slate-400"/>}
                      </div>
                      {bitacoraOpen && (<>
                        {/* Tabs */}
                        <div className="px-2 py-1 border-b border-slate-100 flex items-center gap-1 bg-slate-50 flex-wrap" onClick={e => e.stopPropagation()}>
                          {([
                            { id:'reciente' as const,    label:'Actividad',   count: logic.recentLogs.filter((l:any)=>l.formattedActor!=='VACANTE').length },
                            { id:'operaciones' as const, label:'Operaciones', count: logic.recentLogs.filter((l:any)=>{ const a=(l.action||'').toUpperCase(); return OPS_ACTIONS.has(a); }).length },
                            { id:'alertas' as const,     label:'Novedades',   count: pendingNovedades.length, urgent: pendingNovedades.length > 0 },
                          ]).map(t => (
                            <button key={t.id} onClick={() => setBitacoraTab(t.id)}
                              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase transition-colors
                                ${bitacoraTab===t.id
                                  ? ((t as any).urgent ? 'bg-rose-600 text-white' : 'bg-slate-800 text-white')
                                  : ((t as any).urgent ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'text-slate-400 hover:bg-slate-100')}`}>
                              {t.id === 'alertas' && <Siren size={10}/>}
                              {t.label}
                              <span className={`text-[9px] font-black px-1 rounded-full ${bitacoraTab===t.id ? 'bg-white/20' : (t as any).urgent ? 'bg-rose-500 text-white animate-pulse' : 'bg-slate-200 text-slate-500'}`}>{t.count}</span>
                            </button>
                          ))}
                          <div className="ml-auto flex items-center gap-1">
                            {/* Filtro Mi Guardia */}
                            {session.mySession && bitacoraTab !== 'alertas' && (
                              <button onClick={() => setBitacoraFiltroGuardia(v => !v)}
                                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase transition-colors ${bitacoraFiltroGuardia ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                title="Solo eventos de mi guardia">
                                <Shield size={10}/>MI GUARDIA
                              </button>
                            )}
                            {/* Filtro tipo */}
                            {bitacoraTab !== 'alertas' && (
                              <select value={bitacoraFiltroTipo} onChange={e => setBitacoraFiltroTipo(e.target.value)}
                                className="text-[9px] font-bold border border-slate-200 rounded-lg px-1.5 py-1 bg-white text-slate-600 cursor-pointer" onClick={e => e.stopPropagation()}>
                                <option value="">Todo</option>
                                <option value="ingresos">Ingresos</option>
                                <option value="ausencias">Ausencias</option>
                                <option value="coberturas">Coberturas</option>
                                <option value="sistema">Sistema</option>
                              </select>
                            )}
                            {/* Filtro objetivo */}
                            {bitacoraTab !== 'alertas' && logic.filteredObjectives?.length > 1 && (
                              <select value={bitacoraFiltroObj} onChange={e => setBitacoraFiltroObj(e.target.value)}
                                className="text-[9px] font-bold border border-slate-200 rounded-lg px-1.5 py-1 bg-white text-slate-600 max-w-[90px] cursor-pointer truncate" onClick={e => e.stopPropagation()}>
                                <option value="">Todos obj.</option>
                                {logic.filteredObjectives.map((o:any) => <option key={o.id||o.objectiveId} value={o.id||o.objectiveId}>{o.name}</option>)}
                              </select>
                            )}
                            {/* Cierre de guardia */}
                            {session.mySession && (
                              <button onClick={e => { e.stopPropagation(); setCierreGuardiaOpen(true); }}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase bg-slate-700 text-white hover:bg-slate-800 transition-colors" title="Informe de cierre de guardia">
                                <FileText size={10}/>CIERRE
                              </button>
                            )}
                            <button onClick={toggleSound}
                              className={`p-1 rounded-lg transition-colors ${
                                soundEnabled
                                  ? 'bg-blue-100 hover:bg-blue-200 text-blue-600'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-400'
                              }`}
                              title={soundEnabled ? 'Silenciar alertas' : 'Activar alertas sonoras'}>
                              {soundEnabled ? <Volume2 size={11}/> : <VolumeX size={11}/>}
                            </button>
                            <button onClick={generateDailyReport} className="p-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg" title="Exportar PDF">
                              <Printer size={11}/>
                            </button>
                          </div>
                        </div>

                        {/* ── Tab Actividad / Operaciones ── */}
                        {bitacoraTab !== 'alertas' && (
                        <div className="flex-1 overflow-y-auto" onClick={e => e.stopPropagation()}>
                          <table className="w-full text-[10px] text-left">
                            <thead className="bg-slate-50 text-slate-400 uppercase font-bold sticky top-0 z-10">
                              <tr>
                                <th className="px-3 py-1 w-14">Hora</th>
                                <th className="px-2 py-1 w-32">Evento</th>
                                <th className="px-2 py-1 w-24">Actor</th>
                                <th className="px-2 py-1">Detalle</th>
                                <th className="px-2 py-1 w-6"/>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {filteredBitacora.length === 0 ? (
                                <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-300 text-[10px]">Sin registros</td></tr>
                              ) : filteredBitacora.map((log: any) => {
                                const action = (log.action || '').toUpperCase();
                                const label = ACTION_LABELS[action] || action.replace(/_/g,' ').replace('MANUAL ','');
                                const dot = ACTION_DOT[action] || 'bg-indigo-400';
                                const isNew = log.time && log.time.getTime() > bitacoraLastOpenRef.current;
                                const isExp = bitacoraExpanded === log.id;
                                return (
                                  <React.Fragment key={log.id}>
                                    <tr className={`hover:bg-slate-50/80 transition-colors cursor-pointer ${isNew ? 'bg-indigo-50/60' : ''}`}
                                        onClick={() => setBitacoraExpanded(isExp ? null : log.id)}>
                                      <td className="px-3 py-1.5 font-mono text-slate-400 text-[9px] shrink-0">
                                        {isNew && <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse mr-1 align-middle"/>}
                                        {formatTimeSimple(log.time)}
                                      </td>
                                      <td className="px-2 py-1.5">
                                        <div className="flex items-center gap-1.5">
                                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`}/>
                                          <span className="font-bold text-slate-700 text-[9px] truncate">{label}</span>
                                        </div>
                                      </td>
                                      <td className="px-2 py-1.5 text-slate-500 truncate max-w-[80px] text-[9px]">{log.formattedActor}</td>
                                      <td className="px-2 py-1.5 text-slate-400 truncate max-w-[160px] text-[9px]">{log.fullDetail}</td>
                                      <td className="px-2 py-1.5 text-slate-300">{isExp ? <ChevronDown size={10}/> : <ChevronRight size={10}/>}</td>
                                    </tr>
                                    {isExp && (
                                      <tr className="bg-slate-50">
                                        <td colSpan={5} className="px-4 py-2.5">
                                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px]">
                                            {log.employeeName && <div><span className="text-slate-400 font-bold uppercase">Empleado:</span> <span className="text-slate-700">{log.employeeName}</span></div>}
                                            {log.objectiveName && <div><span className="text-slate-400 font-bold uppercase">Objetivo:</span> <span className="text-slate-700">{log.objectiveName}</span></div>}
                                            {log.shiftId && <div><span className="text-slate-400 font-bold uppercase">Turno ID:</span> <span className="font-mono text-slate-500">{log.shiftId.slice(0,12)}...</span></div>}
                                            {log.module && <div><span className="text-slate-400 font-bold uppercase">Módulo:</span> <span className="text-slate-700">{log.module}</span></div>}
                                            {log.fullDetail && <div className="col-span-2"><span className="text-slate-400 font-bold uppercase">Detalle:</span> <span className="text-slate-600">{log.fullDetail}</span></div>}
                                            <div className="col-span-2 text-slate-300 font-mono">{log.time?.toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba' })}</div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        )}

                        {/* ── Tab Novedades ── */}
                        {bitacoraTab === 'alertas' && (
                        <div className="flex-1 overflow-y-auto">
                          {pendingNovedades.length === 0 ? (
                            <div className="p-6 text-center">
                              <CheckCircle size={24} className="mx-auto mb-2 text-emerald-400 opacity-50"/>
                              <p className="text-xs font-bold text-slate-400">Sin novedades pendientes</p>
                            </div>
                          ) : (() => {
                            const NOV_TYPE_META: Record<string, { label: string; bg: string; border: string }> = {
                              AUSENCIA_CORTO_PLAZO:        { label: 'URGENTE', bg: 'bg-red-600 text-white animate-pulse', border: 'border-l-red-600' },
                              AVISO_AUSENCIA_ANTICIPADA:   { label: 'ANTIC',   bg: 'bg-amber-100 text-amber-800',          border: 'border-l-amber-400' },
                              CONVOCATORIA_RETEN:          { label: 'CONV',    bg: 'bg-indigo-100 text-indigo-700',        border: 'border-l-indigo-500' },
                              FRANCO_TRABAJADO:            { label: 'CONV',    bg: 'bg-indigo-100 text-indigo-700',        border: 'border-l-indigo-500' },
                              VACANTE_PROTOCOLO_COBERTURA: { label: 'PROT',    bg: 'bg-orange-100 text-orange-700',        border: 'border-l-orange-500' },
                              AUSENCIA_AUTO:               { label: 'AUS',     bg: 'bg-rose-100 text-rose-700',            border: 'border-l-rose-500' },
                              AUSENCIA_OPERATIVA:          { label: 'AUS',     bg: 'bg-rose-100 text-rose-700',            border: 'border-l-rose-500' },
                              POSICION_SIN_RELEVO:         { label: 'REL',     bg: 'bg-amber-100 text-amber-700',          border: 'border-l-amber-500' },
                              RETENCION_LARGA:             { label: 'REC',     bg: 'bg-orange-100 text-orange-800',        border: 'border-l-orange-600' },
                              RELEVO_INMINENTE:            { label: 'RELEVO',  bg: 'bg-blue-100 text-blue-800',            border: 'border-l-blue-600' },
                              LLEGADA_TARDE:               { label: 'TARDE',   bg: 'bg-amber-400 text-white animate-pulse', border: 'border-l-amber-400' },
                              TURNO_COMPLETADO_AUTO:       { label: 'FIN',     bg: 'bg-slate-100 text-slate-600',           border: 'border-l-slate-300' },
                              INGRESO_AUTOREGISTRO:        { label: 'INGRESO', bg: 'bg-teal-100 text-teal-700',             border: 'border-l-teal-500' },
                            };
                            const getMeta = (t: string) => NOV_TYPE_META[t] || { label: 'NOV', bg: 'bg-slate-100 text-slate-600', border: 'border-l-slate-300' };
                            const groups: { type: string; items: any[] }[] = [];
                            const seen = new Map<string, any[]>();
                            pendingNovedades.forEach((n: any) => {
                              if (!seen.has(n.type)) { seen.set(n.type, []); groups.push({ type: n.type, items: seen.get(n.type)! }); }
                              seen.get(n.type)!.push(n);
                            });
                            return groups.map(({ type, items }) => {
                              const meta = getMeta(type);
                              return (
                                <div key={type}>
                                  <div className="px-3 py-1 flex items-center gap-2 bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${meta.bg}`}>{meta.label}</span>
                                    <span className="text-[9px] font-bold text-slate-500 flex-1 truncate">{type.replace(/_/g,' ')}</span>
                                    <span className="text-[9px] text-slate-400 font-mono">{items.length}</span>
                                    {items.length > 1 && (
                                      <button onClick={(e) => { e.stopPropagation(); handleDismissAllByType(type); }}
                                        className="text-[9px] font-bold text-slate-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors shrink-0">
                                        ✕ todas
                                      </button>
                                    )}
                                  </div>
                                  {items.map((n: any) => {
                                    const ts = n.createdAt?.seconds ? new Date(n.createdAt.seconds * 1000) : null;
                                    return (
                                      <div key={n.id} onClick={() => setDetailNovedad(n)} className={`px-3 py-2 flex items-center gap-2 border-l-4 ${meta.border} border-b border-slate-50 hover:bg-slate-50/60 transition-colors cursor-pointer`}>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs lg:text-[10px] font-bold text-slate-800 truncate leading-tight">
                                            {n.employeeName && n.objectiveName
                                              ? <>{n.employeeName} <span className="text-slate-400 font-normal">·</span> {n.objectiveName}</>
                                              : n.objectiveName || n.employeeName || n.type}
                                            {n.positionName && <span className="text-slate-400 font-normal text-[9px]"> · {n.positionName}</span>}
                                          </p>
                                          <p className="text-[9px] text-slate-400 truncate leading-tight">{n.description || '-'}</p>
                                        </div>
                                        <span className="text-[9px] text-slate-400 font-mono shrink-0">
                                          {ts ? ts.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Argentina/Cordoba'}) : '--'}
                                        </span>
                                        <button onClick={(e) => { e.stopPropagation(); handleAtenderNovedad(n); }}
                                          className="p-1.5 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors shrink-0" title="Atender">
                                          <CheckCircle size={11}/>
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            });
                          })()}
                          {recentAtendidas.length > 0 && (
                            <div className="border-t border-slate-100 bg-slate-50/80">
                              <p className="px-3 py-1 text-[9px] font-black uppercase text-slate-400">Atendidas recientes</p>
                              {recentAtendidas.slice(0,5).map((n: any) => (
                                <div key={n.id} className="px-3 py-1 flex items-center gap-2 border-b border-slate-100 text-[9px]">
                                  <CheckCircle size={10} className="text-emerald-500 shrink-0"/>
                                  <span className="flex-1 truncate text-slate-500">{n.objectiveName || n.employeeName || n.type}</span>
                                  <span className="text-slate-300 font-mono text-[8px]">
                                    {n.atendidaAt?.seconds ? new Date(n.atendidaAt.seconds*1000).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}) : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        )}
                      </>)}
                    </div>
                </div>

                {/* PANEL FLOTANTE DE ALERTAS — siempre visible (también con mapa undocked) */}
                <React.Fragment>
                {/* Backdrop mobile cuando panel abierto */}
                {notifPanelOpen && <div className="fixed inset-0 bg-black/40 z-[999] lg:hidden" onClick={() => setNotifPanelOpen(false)}/>}
                <div className={notifPanelOpen
                    ? 'fixed bottom-0 left-0 right-0 z-[1000] lg:absolute lg:inset-auto lg:bottom-8 lg:left-8'
                    : 'absolute bottom-8 left-8 z-[1000]'}>
                {(() => {
                    // Calcular priority shifts con el MISMO filtro que stats.prioridad (hoy + activos)
                    const _now = new Date();
                    const _hoy = logic.processedData.filter((s:any) => isSameDay(s.shiftDateObj, _now) || ((s.isPresent || s.isRetention) && !s.isCompleted));
                    const priorityShiftsPanel = _hoy.filter((s:any) => (s.isImminent || s.isRetention || s.isEarlyStart || s.isAwaitingCoverageCheckIn) && !s.isFranco);
                    const totalAlerts = pendingNovedades.length + priorityShiftsPanel.length;
                    return !notifPanelOpen ? (
                    <button onClick={() => setNotifPanelOpen(true)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg font-black uppercase text-sm transition-all hover:scale-105 ${totalAlerts > 0 ? 'bg-rose-600 text-white' : 'bg-slate-800 text-white'}`}>
                        <Siren size={15} className={totalAlerts > 0 ? 'animate-pulse' : ''}/>
                        Alertas
                        <span className={`text-xs font-black px-2 py-0.5 rounded-full ${totalAlerts > 0 ? 'bg-white text-rose-600' : 'bg-white/20 text-white'}`}>
                            {totalAlerts}
                        </span>
                    </button>
                ) : (
                    <div className="w-full lg:w-[480px] flex flex-col bg-white rounded-t-2xl lg:rounded-xl shadow-2xl border border-slate-200 animate-in slide-in-from-bottom-4 max-h-[92vh] lg:max-h-[70vh]">
                        <div className="bg-slate-900 rounded-t-2xl">
                            {/* Drag handle — solo mobile */}
                            <div className="flex justify-center pt-2 pb-0 lg:hidden">
                                <div className="w-10 h-1 bg-white/30 rounded-full"/>
                            </div>
                            <div className="px-3 py-2.5 flex items-center gap-2">
                                <Siren size={14} className="text-rose-400 shrink-0"/>
                                <span className="font-black uppercase text-xs text-white flex-1">Alertas y Prioridad</span>
                                {totalAlerts > 0 && <span className="bg-rose-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full">{totalAlerts}</span>}
                                {pendingNovedades.some((n: any) => pendingNovedades.filter((x: any) => x.type === n.type && x.shiftId === n.shiftId).length > 1) && (
                                    <button onClick={cleanupDuplicateNovedades} title="Limpiar alertas duplicadas" className="p-1.5 hover:bg-amber-500/30 rounded-lg transition-colors text-amber-400" >
                                        <RefreshCw size={12}/>
                                    </button>
                                )}
                                <button onClick={() => setNotifPanelOpen(false)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"><X size={14} className="text-slate-400"/></button>
                            </div>
                        </div>

                        {/* â"€â"€ Sección PRIORIDAD — usa priorityShiftsPanel ya calculado (mismo filtro que stats) â"€â"€ */}
                        {priorityShiftsPanel.length > 0 && (() => {
                            const priorityShifts = priorityShiftsPanel;
                            return (
                                <div className="border-b border-slate-200">
                                    <div className="px-3 py-1 bg-rose-50 flex items-center gap-1.5">
                                        <AlertTriangle size={10} className="text-rose-600 shrink-0"/>
                                        <span className="text-[9px] font-black text-rose-700 uppercase flex-1">Prioridad</span>
                                        <span className="text-[9px] font-bold text-rose-500">{priorityShifts.length} turnos</span>
                                    </div>
                                    {priorityShifts.map((s: any) => (
                                        <div key={s.id} className="border-b border-slate-100">
                                            {/* Mobile: tarjeta grande */}
                                            <div className="lg:hidden px-4 py-4 bg-white active:bg-slate-50">
                                                <div className="flex items-center gap-3 mb-3">
                                                    <div className={`w-11 h-11 rounded-full flex items-center justify-center text-base font-black shrink-0 ${s.isRetention ? 'bg-orange-100 text-orange-700' : 'bg-rose-100 text-rose-700'}`}>
                                                        {(s.employeeName || '?')[0]}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-black text-slate-900 truncate">{s.employeeName || 'Desconocido'}</p>
                                                        <p className="text-xs text-slate-500 truncate">{s.objectiveName}</p>
                                                        <p className="text-xs text-indigo-500 font-semibold truncate">{s.positionName} · <span className="font-mono text-slate-500">{formatTimeRange(s.shiftDateObj, s.endDateObj)}</span></p>
                                                    </div>
                                                    <span className={`text-[10px] font-black px-2 py-1 rounded-full shrink-0 ${s.isRetention ? 'bg-orange-100 text-orange-700' : s.isPendingRetention ? 'bg-yellow-100 text-yellow-700' : s.isEarlyStart ? 'bg-indigo-100 text-indigo-700' : s.isAwaitingCoverageCheckIn ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-100 text-rose-700'}`}>
                                                        {s.isRetention ? 'RECARGO' : s.isPendingRetention ? 'ATENCIÓN' : s.isEarlyStart ? 'ADELANTADO' : s.isAwaitingCoverageCheckIn ? 'CONVOCADO' : 'INMINENTE'}
                                                    </span>
                                                </div>
                                                {s.isRetention ? (
                                                    <div className="flex gap-2">
                                                        <button onClick={() => { setNotifPanelOpen(false); setCheckoutData({isOpen:true, shift:s}); }} className="flex-1 flex items-center justify-center gap-2 py-3 bg-purple-600 text-white rounded-xl font-black text-sm active:bg-purple-700"><LogOut size={16}/>SALIDA</button>
                                                        <button onClick={() => { setNotifPanelOpen(false); setInterruptData({isOpen:true, shift:s}); }} className="px-4 py-3 bg-red-50 text-red-600 border border-red-200 rounded-xl active:bg-red-100"><Siren size={18}/></button>
                                                    </div>
                                                ) : (
                                                    <div className="flex gap-2">
                                                        <button onClick={() => { setNotifPanelOpen(false); setHandoverData({isOpen:true, shift:s}); }} className="flex-1 flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-xl font-black text-sm active:bg-indigo-700"><PlayCircle size={16}/>DAR PRESENTE</button>
                                                        <button onClick={() => { setNotifPanelOpen(false); setAttendanceData({isOpen:true, shift:s}); }} className="px-4 py-3 bg-amber-50 text-amber-600 border border-amber-200 rounded-xl active:bg-amber-100"><AlertTriangle size={18}/></button>
                                                    </div>
                                                )}
                                            </div>
                                            {/* Desktop: fila compacta */}
                                            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 border-l-4 border-l-rose-500 bg-white hover:bg-rose-50/30 transition-colors">
                                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 ${s.isRetention ? 'bg-orange-100 text-orange-700' : 'bg-rose-100 text-rose-700'}`}>
                                                    {(s.employeeName || '?')[0]}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[10px] font-bold text-slate-800 truncate leading-tight">
                                                        {s.employeeName || 'Desconocido'}
                                                        <span className={`ml-1.5 text-[9px] font-black px-1 rounded ${s.isRetention ? 'bg-orange-100 text-orange-700' : s.isPendingRetention ? 'bg-yellow-100 text-yellow-700' : s.isEarlyStart ? 'bg-indigo-100 text-indigo-700' : s.isAwaitingCoverageCheckIn ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-100 text-rose-700'}`}>
                                                            {s.isRetention ? 'RECARGO' : s.isPendingRetention ? 'ATENCIÓN' : s.isEarlyStart ? 'ADELANTADO' : s.isAwaitingCoverageCheckIn ? 'CONVOCADO' : 'INMINENTE'}
                                                        </span>
                                                    </p>
                                                    <p className="text-[9px] text-slate-400 truncate leading-tight">{s.objectiveName} · <span className="text-indigo-500">{s.positionName}</span> · <span className="font-mono">{formatTimeRange(s.shiftDateObj, s.endDateObj)}</span></p>
                                                </div>
                                                <div className="flex gap-1 shrink-0">
                                                    {s.isRetention ? (<>
                                                        <button onClick={() => { setNotifPanelOpen(false); setCheckoutData({isOpen:true, shift:s}); }} className="p-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors" title="Salida"><LogOut size={11}/></button>
                                                        <button onClick={() => { setNotifPanelOpen(false); setInterruptData({isOpen:true, shift:s}); }} className="p-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors" title="Baja"><Siren size={11}/></button>
                                                    </>) : (<>
                                                        <button onClick={() => { setNotifPanelOpen(false); setHandoverData({isOpen:true, shift:s}); }} className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors" title="Dar presente"><PlayCircle size={11}/></button>
                                                        <button onClick={() => { setNotifPanelOpen(false); setAttendanceData({isOpen:true, shift:s}); }} className="p-1.5 bg-amber-50 text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors" title="Marcar ausente"><AlertTriangle size={11}/></button>
                                                    </>)}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}

                        <div className="flex-1 overflow-y-auto">
                            {pendingNovedades.length === 0 ? (
                                <div className="p-4 text-center">
                                    <CheckCircle size={22} className="mx-auto mb-1.5 text-emerald-400 opacity-50"/>
                                    <p className="text-xs font-bold text-slate-400">
                                        {priorityShiftsPanel.length > 0
                                            ? 'Sin novedades pendientes — revisá la sección Prioridad arriba'
                                            : 'Sin alertas pendientes'}
                                    </p>
                                </div>
                            ) : (() => {
                                const NOV_META: Record<string, { label: string; bg: string; border: string; actionBg: string }> = {
                                    AUSENCIA_CORTO_PLAZO:        { label: 'URGENTE', bg: 'bg-red-600 text-white animate-pulse',   border: 'border-l-red-600',    actionBg: 'bg-red-600 hover:bg-red-700' },
                                    AVISO_AUSENCIA_ANTICIPADA:   { label: 'ANTIC',   bg: 'bg-amber-100 text-amber-800',             border: 'border-l-amber-400',  actionBg: 'bg-amber-600 hover:bg-amber-700' },
                                    CONVOCATORIA_RETEN:          { label: 'CONV',    bg: 'bg-indigo-100 text-indigo-700',           border: 'border-l-indigo-500', actionBg: 'bg-indigo-600 hover:bg-indigo-700' },
                                    FRANCO_TRABAJADO:            { label: 'CONV',    bg: 'bg-indigo-100 text-indigo-700',           border: 'border-l-indigo-500', actionBg: 'bg-indigo-600 hover:bg-indigo-700' },
                                    RETENCION:                   { label: 'CONV',    bg: 'bg-indigo-100 text-indigo-700',           border: 'border-l-indigo-500', actionBg: 'bg-indigo-600 hover:bg-indigo-700' },
                                    ADELANTO_TURNO:              { label: 'ADEL',    bg: 'bg-indigo-100 text-indigo-700',           border: 'border-l-indigo-500', actionBg: 'bg-indigo-600 hover:bg-indigo-700' },
                                    VACANTE_PROTOCOLO_COBERTURA: { label: 'PROT',    bg: 'bg-orange-100 text-orange-700',           border: 'border-l-orange-500', actionBg: 'bg-orange-600 hover:bg-orange-700' },
                                    AUSENCIA_AUTO:               { label: 'AUS',     bg: 'bg-rose-100 text-rose-700',               border: 'border-l-rose-500',   actionBg: 'bg-rose-600 hover:bg-rose-700' },
                                    AUSENCIA_OPERATIVA:          { label: 'AUS',     bg: 'bg-rose-100 text-rose-700',               border: 'border-l-rose-500',   actionBg: 'bg-rose-600 hover:bg-rose-700' },
                                    POSICION_SIN_RELEVO:         { label: 'REL',     bg: 'bg-amber-100 text-amber-700',             border: 'border-l-amber-500',  actionBg: 'bg-amber-600 hover:bg-amber-700' },
                                    RELEVO_NO_PRESENTADO:        { label: 'REL',     bg: 'bg-amber-100 text-amber-700',             border: 'border-l-amber-500',  actionBg: 'bg-amber-600 hover:bg-amber-700' },
                                    RETENCION_LARGA:             { label: 'REC',     bg: 'bg-orange-100 text-orange-800',           border: 'border-l-orange-600', actionBg: 'bg-orange-700 hover:bg-orange-800' },
                                    RECARGO_12H:                 { label: 'REC+12',  bg: 'bg-orange-100 text-orange-800',           border: 'border-l-orange-600', actionBg: 'bg-orange-700 hover:bg-orange-800' },
                                    RETENCION_DETECTADA:         { label: 'REC',     bg: 'bg-orange-100 text-orange-800',           border: 'border-l-orange-600', actionBg: 'bg-orange-700 hover:bg-orange-800' },
                                    RELEVO_INMINENTE:            { label: 'RELEVO',  bg: 'bg-blue-100 text-blue-800',               border: 'border-l-blue-600',   actionBg: 'bg-blue-600 hover:bg-blue-700' },
                                    LLEGADA_TARDE:               { label: 'TARDE',   bg: 'bg-amber-400 text-white animate-pulse',    border: 'border-l-amber-400',  actionBg: 'bg-amber-500 hover:bg-amber-600' },
                                    TURNO_COMPLETADO_AUTO:       { label: 'FIN',     bg: 'bg-slate-100 text-slate-600',              border: 'border-l-slate-400',  actionBg: 'bg-slate-600 hover:bg-slate-700' },
                                    INGRESO_AUTOREGISTRO:        { label: 'INGRESO', bg: 'bg-teal-100 text-teal-700',                border: 'border-l-teal-500',   actionBg: 'bg-teal-600 hover:bg-teal-700' },
                                    VACANTE_OPERATIVA:           { label: 'VAC RFZ', bg: 'bg-fuchsia-100 text-fuchsia-800',         border: 'border-l-fuchsia-500', actionBg: 'bg-fuchsia-700 hover:bg-fuchsia-800' },
                                    TURA_EXTENSION:              { label: 'TURA',    bg: 'bg-violet-100 text-violet-800',           border: 'border-l-violet-500', actionBg: 'bg-violet-700 hover:bg-violet-800' },
                                };
                                const getMeta = (t: string) => NOV_META[t] || { label: 'NOV', bg: 'bg-slate-100 text-slate-600', border: 'border-l-slate-300', actionBg: 'bg-slate-700 hover:bg-slate-800' };
                                // Agrupar por tipo
                                const groups: { type: string; items: any[] }[] = [];
                                const seen = new Map<string, any[]>();
                                pendingNovedades.forEach((n: any) => {
                                    if (!seen.has(n.type)) { seen.set(n.type, []); groups.push({ type: n.type, items: seen.get(n.type)! }); }
                                    seen.get(n.type)!.push(n);
                                });
                                return groups.map(({ type, items }) => {
                                    const meta = getMeta(type);
                                    return (
                                        <div key={type}>
                                            {/* Header del grupo con botón "✕ todas" */}
                                            <div className="px-3 py-1 flex items-center gap-2 bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${meta.bg}`}>{meta.label}</span>
                                                <span className="text-[9px] font-bold text-slate-500 flex-1 truncate">{type.replace(/_/g,' ')}</span>
                                                <span className="text-[9px] text-slate-400 font-mono shrink-0">{items.length}</span>
                                                {items.length > 1 && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDismissAllByType(type); }}
                                                        className="text-[9px] font-bold text-slate-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors shrink-0"
                                                        title={`Descartar todas (${items.length})`}
                                                    >✕ todas</button>
                                                )}
                                            </div>
                                            {items.map((n: any) => {
                                                const ts = n.createdAt?.seconds ? new Date(n.createdAt.seconds * 1000) : null;
                                                return (
                                                    <div key={n.id} className={`flex items-center gap-2 px-3 py-1.5 border-l-4 ${meta.border} bg-white border-b border-slate-50 hover:bg-slate-50/50 transition-colors`}>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-[10px] font-bold text-slate-800 truncate leading-tight">
                                                                {n.employeeName && n.objectiveName
                                                                    ? <>{n.employeeName} <span className="text-slate-400 font-normal">·</span> {n.objectiveName}</>
                                                                    : n.objectiveName || n.employeeName || n.type}
                                                            </p>
                                                            <p className="text-[9px] text-slate-400 truncate leading-tight">{n.positionName || n.description || ''}</p>
                                                        </div>
                                                        <span className="text-[9px] font-mono text-slate-500 w-10 text-right shrink-0">{ts ? ts.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Argentina/Cordoba'}) : '--'}</span>
                                        <button onClick={(e) => { e.stopPropagation(); handleAtenderNovedad(n); }} className="p-1 bg-slate-700 text-white rounded hover:bg-slate-800 transition-colors shrink-0" title="Atender"><CheckCircle size={10}/></button>
                                                        <button onClick={() => { setNotifPanelOpen(false); setDetailNovedad(n); }}
                                                            className={`text-[9px] font-black text-white px-2 py-1 rounded-lg w-16 text-center shrink-0 transition-colors ${meta.actionBg}`}>VER</button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    </div>
                    );
                })()}
                </div>
                </React.Fragment>

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
            <CoverageModal isOpen={coverageData.isOpen} onClose={() => setCoverageData({isOpen:false,shift:null})} absenceShift={coverageData.shift} logic={logic}/>
            <AbsenceDecisionModal isOpen={absenceDecisionData.isOpen} onClose={() => setAbsenceDecisionData({isOpen:false,shift:null})} shift={absenceDecisionData.shift} onDeclareAbsent={handleDeclareAbsentT5} onLateArrival={handleLateArrival} onOpenWA={handleOpenWA}/>
            <RRHHVacancyModal isOpen={rrhhVacancyData.isOpen} onClose={() => setRrhhVacancyData({isOpen:false,shift:null})} shift={rrhhVacancyData.shift} logic={logic} onCoverageProtocol={(s: any) => setCoverageData({isOpen:true,shift:s})} onSendToPlanning={handleReportPlanning}/>
            <WorkedDayOffModal isOpen={workedFrancoData.isOpen} onClose={() => setWorkedFrancoData({isOpen:false,shift:null})} shift={workedFrancoData.shift}/>
            <ManualRetentionModal isOpen={manualRetentionData.isOpen} onClose={() => setManualRetentionData({isOpen:false,shift:null})} shift={manualRetentionData.shift}/>
            <WAComposeModal isOpen={waData.isOpen} onClose={() => setWaData({isOpen:false,ctx:{employeeName:'',phone:''}})} ctx={waData.ctx}/>
            {showDebugPanel && (<DebugPanel processedData={logic.processedData} servicesSLA={logic.servicesSLA} publishStatusMap={logic.publishStatusMap} rawShifts={logic.rawShifts as any} onClose={() => setShowDebugPanel(false)}/>)}
            {/* ── MODAL CIERRE DE GUARDIA ── */}
            {cierreGuardiaOpen && session.mySession && (() => {
                const guardStart = session.mySession!.startTime;
                const logsGuardia = logic.recentLogs.filter((l:any) => l.time && l.time.getTime() >= guardStart.getTime());
                const resumen = {
                    ingresos: logsGuardia.filter((l:any) => ['CHECKIN','CHECK_IN','HANDOVER','PRESENTE'].includes((l.action||'').toUpperCase())).length,
                    salidas: logsGuardia.filter((l:any) => ['CHECKOUT','CHECK_OUT'].includes((l.action||'').toUpperCase())).length,
                    ausencias: logsGuardia.filter((l:any) => ['MARK_ABSENT','AUSENTE','ATTENDANCE'].includes((l.action||'').toUpperCase())).length,
                    coberturas: logsGuardia.filter((l:any) => ['COVERAGE','COBERTURA_RELEVO'].includes((l.action||'').toUpperCase())).length,
                    retenes: logsGuardia.filter((l:any) => ['CONVOCATORIA_RETEN','ADELANTO_TURNO','FRANCO_TRABAJADO'].includes((l.action||'').toUpperCase())).length,
                    bajas: logsGuardia.filter((l:any) => ['INTERRUPT','BAJA_SERVICIO'].includes((l.action||'').toUpperCase())).length,
                };
                const fmtHora = (d: Date) => d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Argentina/Cordoba'});
                const fmtFecha = (d: Date) => d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Argentina/Cordoba'});
                return (
                    <div className="fixed inset-0 bg-black/60 z-[2000] flex items-center justify-center p-4" onClick={() => setCierreGuardiaOpen(false)}>
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                            {/* Header */}
                            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
                                    <FileText size={16} className="text-white"/>
                                </div>
                                <div className="flex-1">
                                    <h2 className="font-black text-slate-800 text-sm">Informe de Cierre de Guardia</h2>
                                    <p className="text-[10px] text-slate-400">{session.mySession!.operatorName || 'Operador'} · {fmtFecha(guardStart)} · {fmtHora(guardStart)} → ahora</p>
                                </div>
                                <button onClick={() => setCierreGuardiaOpen(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={14}/></button>
                            </div>
                            {/* Resumen */}
                            <div className="px-5 py-4 border-b border-slate-100">
                                <p className="text-[10px] font-black uppercase text-slate-400 mb-2">Resumen de la guardia</p>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { label: 'Ingresos',   value: resumen.ingresos,   color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                                        { label: 'Salidas',    value: resumen.salidas,    color: 'bg-purple-50 text-purple-700 border-purple-200' },
                                        { label: 'Ausencias',  value: resumen.ausencias,  color: 'bg-rose-50 text-rose-700 border-rose-200' },
                                        { label: 'Coberturas', value: resumen.coberturas, color: 'bg-orange-50 text-orange-700 border-orange-200' },
                                        { label: 'Retenes',    value: resumen.retenes,    color: 'bg-sky-50 text-sky-700 border-sky-200' },
                                        { label: 'Bajas',      value: resumen.bajas,      color: 'bg-red-50 text-red-700 border-red-200' },
                                    ].map(s => (
                                        <div key={s.label} className={`rounded-xl border px-3 py-2 text-center ${s.color}`}>
                                            <div className="text-xl font-black">{s.value}</div>
                                            <div className="text-[9px] font-bold uppercase">{s.label}</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-2 flex gap-2 text-[9px] text-slate-400">
                                    <span>{logsGuardia.length} eventos totales</span>
                                    {pendingNovedades.length > 0 && <span className="text-rose-500 font-bold">· {pendingNovedades.length} novedades pendientes al cierre</span>}
                                </div>
                            </div>
                            {/* Cronología */}
                            <div className="px-5 py-3 border-b border-slate-100">
                                <p className="text-[10px] font-black uppercase text-slate-400 mb-2">Cronología ({logsGuardia.length} eventos)</p>
                                <div className="max-h-48 overflow-y-auto space-y-0.5">
                                    {logsGuardia.length === 0 ? (
                                        <p className="text-[10px] text-slate-300 py-2">Sin eventos registrados en esta guardia</p>
                                    ) : logsGuardia.map((l:any) => {
                                        const act = (l.action||'').toUpperCase();
                                        const lbl = ACTION_LABELS[act] || act.replace(/_/g,' ');
                                        const dot = ACTION_DOT[act] || 'bg-indigo-400';
                                        return (
                                            <div key={l.id} className="flex items-start gap-2 text-[9px] py-0.5">
                                                <span className="font-mono text-slate-400 shrink-0 w-10 mt-0.5">{l.time ? l.time.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Argentina/Cordoba'}) : '--'}</span>
                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${dot}`}/>
                                                <div className="flex-1 min-w-0">
                                                    <span className="font-bold text-slate-700">{lbl}</span>
                                                    {l.employeeName && <span className="text-slate-400"> · {l.employeeName}</span>}
                                                    {l.fullDetail && <div className="text-slate-400 truncate">{l.fullDetail}</div>}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            {/* Novedades pendientes */}
                            {pendingNovedades.length > 0 && (
                            <div className="px-5 py-3 border-b border-slate-100">
                                <p className="text-[10px] font-black uppercase text-rose-500 mb-2">⚠ Novedades pendientes al cierre</p>
                                <div className="space-y-1 max-h-24 overflow-y-auto">
                                    {pendingNovedades.map((n:any) => (
                                        <div key={n.id} className="flex items-center gap-2 text-[9px]">
                                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"/>
                                            <span className="text-slate-600 truncate">{n.objectiveName || n.employeeName || n.type} {n.positionName ? `· ${n.positionName}` : ''}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            )}
                            {/* Observaciones */}
                            <div className="px-5 py-4">
                                <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Observaciones del operador</label>
                                <textarea
                                    value={cierreObs}
                                    onChange={e => setCierreObs(e.target.value)}
                                    placeholder="Sin novedad al cierre..."
                                    rows={3}
                                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-slate-400"
                                />
                                <div className="flex gap-2 mt-3">
                                    <button onClick={() => setCierreGuardiaOpen(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors">Cancelar</button>
                                    <button onClick={handleCierreGuardia} disabled={cierreLoading}
                                        className="flex-1 py-2.5 rounded-xl bg-slate-800 text-white text-xs font-bold hover:bg-slate-900 transition-colors disabled:opacity-50">
                                        {cierreLoading ? 'Guardando...' : 'Confirmar cierre'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </DashboardLayout>
        {detailNovedad && (
            <NovedadDetailPopup
                novedad={detailNovedad}
                onClose={() => setDetailNovedad(null)}
                onAtender={handleAtenderNovedad}
            />
        )}
        </>
    );
}
