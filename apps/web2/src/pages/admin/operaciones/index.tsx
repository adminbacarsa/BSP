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
    MapPin, UserCheck, Navigation, Users, ArrowLeftRight, BellRing, ChevronLeft
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { useOperacionesMonitor } from '@/hooks/useOperacionesMonitor';
import { useAutoMonitor } from '@/hooks/useAutoMonitor';
import { useOperatorSession } from '@/hooks/useOperatorSession';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { POPUP_STYLES } from '@/components/operaciones/mapStyles';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { doc, updateDoc, serverTimestamp, addDoc, collection, setDoc, Timestamp, writeBatch, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore';
import { openWhatsApp, waMensaje } from '@/lib/whatsapp';
import { WAComposeModal, type WAComposeContext } from '@/components/common/WAComposeModal';
import { db } from '@/lib/firebase';
import { getAuth } from 'firebase/auth';
import { updateDocForEmpresa, stampEmpresaId, assertDocBelongsToEmpresa, shouldScopeQueriesToEmpresa } from '@/lib/multiempresa';

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
    return ( <section className={`relative pl-6 border-l-2 ${s.border}`}> <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white ${s.dot}`}></div> <h4 className={`text-xs font-black uppercase mb-2 cursor-pointer flex items-center gap-2 ${s.text}`} onClick={onToggle}> {title} {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} </h4> {expanded && ( <div className="mt-2 space-y-2 max-h-48 overflow-y-auto custom-scrollbar p-1"> {items?.length > 0 ? items.map((e:any) => ( <div key={e.id} className={`flex justify-between items-center p-2 border rounded-lg shadow-sm ${s.bg}`}> <div> <span className="text-xs font-bold text-slate-800 block">{e.fullName || e.employeeName}</span> {context === 'INTERCAMBIO' && <span className="text-[10px] text-purple-700 block">{e.objectiveName} (Quedan: {e.remainingGuards})</span>} {e.distance !== undefined && e.distance < 1000 && ( <div className="flex items-center gap-2 mt-0.5"> <span className="text-[9px] bg-white border px-1.5 rounded text-slate-500 flex items-center gap-1"><Navigation size={8}/> {e.distance.toFixed(1)} km</span> <span className="text-[9px] text-slate-400">~{e.eta} min</span> </div> )} </div> <div className="flex gap-1"> <button onClick={()=>onWhatsapp(e, context)} className="p-1.5 bg-white text-emerald-600 border rounded hover:bg-emerald-50"><MessageCircle size={14}/></button> <button onClick={()=>onPhone(e)} className="p-1.5 bg-white text-blue-600 border rounded hover:bg-blue-50"><Phone size={14}/></button> <button onClick={()=>onAction(e)} className={`px-2 py-1.5 text-white text-[10px] font-bold rounded shadow-sm ${s.btn}`}> {context === 'INTERCAMBIO' ? 'MOVER' : 'ASIGNAR'} </button> </div> </div> )) : <p className="text-[10px] text-slate-400 italic">No hay candidatos.</p>} </div> )} </section> );
};

// --- MODALES (LÓGICA OPERATIVA) ---
const HandoverModal = ({ isOpen, onClose, incomingShift, logic, onOpenSwap }: any) => {
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = !!(empresa as any)?.migracionCompleta;
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
    const tooLate = wasAbsent && diffMin > LATE_LIMIT_MIN;
    // Detectar si el turno ya fue cubierto por otro guardia
    const isCovered = incomingShift.status === 'COVERED' || !!incomingShift.coveredByEmployeeId;

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
    // Ordenados por FIFO: quien lleva más minutos trabajados se va primero
    const activeGuards = logic.processedData
        .filter((s: any) => {
            if (s.id === incomingShift.id || !samePost(s) || !s.isPresent || s.isCompleted) return false;
            if (s.isRetention) return true;                                    // retenido → siempre candidato
            const minutesUntilEnd = (toDate(s.endDateObj).getTime() - now.getTime()) / 60000;
            return minutesUntilEnd <= 15;                                      // ≤15 min para terminar
        })
        .sort((a: any, b: any) => (b.totalMinutesWorked ?? 0) - (a.totalMinutesWorked ?? 0)); // FIFO: más tiempo → primero

    const sla = (logic.servicesSLA || []).find((s: any) => s.objectiveId === incomingShift.objectiveId);
    const pos = sla?.positions?.find((p: any) => normPosName(p.name) === normPosName(incomingShift.positionName));
    const positionCapacity = Math.max(1, Number(pos?.quantity) || 1);
    const mustRelevar = activeGuards.length >= positionCapacity;

    // ── INTERCAMBIO DE TURNOS ────────────────────────────────────────────────
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
                title: '🔄 Intercambio de turno',
                body: `Cubrís el turno de ${coveringName} en ${guardBNextShift.objectiveName} (${formatTimeSimple(guardBNextShift.shiftDateObj)} - ${formatTimeSimple(guardBNextShift.endDateObj)}).`,
                read: false, createdAt: nowTs,
            }, shiftEmpresaId));
            await addDoc(collection(db, 'user_notifications'), stampEmpresaId({
                userId: coveringEmpId,
                type: 'INTERCAMBIO',
                title: '🔄 Intercambio de turno',
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

    const handleConfirm = async (prevShiftId: string | null) => {
        if (mustRelevar && !prevShiftId) {
            toast.error(`Puesto completo (${positionCapacity} pax). Seleccioná a quién relevar.`);
            return;
        }
        try {
            await assertDocBelongsToEmpresa('turnos', incomingShift.id, empresaId, migracionCompleta);
            if (prevShiftId) await assertDocBelongsToEmpresa('turnos', prevShiftId, empresaId, migracionCompleta);
            const batch = writeBatch(db);
            // Regla de liquidación: realStartTime = hora planificada (no la real de llegada)
            // El guardia siempre cobra desde su hora planificada, llegue antes o después.
            // Excepción: adelanto por cobertura (isEarlyStart) → usa adjustedStartTime del operador.
            const incomingScheduledStart = incomingShift.shiftDateObj instanceof Date
                ? incomingShift.shiftDateObj
                : toDate(incomingShift.shiftDateObj);
            const isEarlyStartShift = !!incomingShift.isEarlyStart;
            // Adelanto: usa adjustedStartTime (= inicio de la vacante a cubrir, no la hora de llegada)
            // Así el guardia cobra desde las 7 AM aunque haya llegado a las 8 AM
            const incomingRealStart = isEarlyStartShift
                ? (incomingShift.adjustedStartTime
                    ? (incomingShift.adjustedStartTime.toDate
                        ? Timestamp.fromDate(incomingShift.adjustedStartTime.toDate())
                        : Timestamp.fromDate(new Date(incomingShift.adjustedStartTime)))
                    : serverTimestamp())
                : Timestamp.fromDate(incomingScheduledStart); // normal: hora planificada
            batch.update(doc(db, 'turnos', incomingShift.id), {
                isPresent:           true,
                status:              'PRESENT',
                realStartTime:       incomingRealStart,
                isLate:              status === 'LATE',
                // Limpiar flags de ausencia — el guardia llegó tarde pero llegó
                isAbsent:            false,
                absenceType:         null,
                absenceDetectedAt:   null,
                absenceReversedAt:   serverTimestamp(),
                absenceReversedBy:   'OPERACIONES',
            });
            if (prevShiftId) {
                // Horas completas: si el relevo es anticipado, el saliente cobra hasta su hora programada de fin
                const prevShift = logic.processedData.find((s: any) => s.id === prevShiftId);
                const prevEnd = prevShift ? toDate(prevShift.endDateObj) : null;
                const nowDate = new Date();
                const isEarlyRelevo = prevEnd && prevEnd > nowDate;
                const outgoingRealEnd = isEarlyRelevo
                    ? Timestamp.fromDate(prevEnd!)   // hora programada → horas completas
                    : serverTimestamp();              // ya pasó el horario → hora real
                batch.update(doc(db, 'turnos', prevShiftId), {
                    realEndTime: outgoingRealEnd,
                    isCompleted: true,
                    status: 'COMPLETED',
                    isPresent: false,
                    relievedEarly: isEarlyRelevo,    // flag para trazabilidad
                });
            }
            await batch.commit();

            // Notificar al guardia saliente si fue relevado
            if (prevShiftId) {
                const prevShift = logic.processedData.find((s: any) => s.id === prevShiftId);
                if (prevShift?.employeeId) {
                    const shiftEmpresaId = String(incomingShift.empresaId || empresaId || '').trim();
                    await addDoc(collection(db, 'user_notifications'), stampEmpresaId({
                        userId:   prevShift.employeeId,
                        type:     'RELEVO',
                        title:    '✅ Turno finalizado — relevado',
                        body:     `Fuiste relevado por ${incomingShift.employeeName} en ${incomingShift.objectiveName}. Tu turno finalizó.`,
                        read:     false,
                        createdAt: serverTimestamp(),
                    }, shiftEmpresaId)).catch(() => {});
                }
            }

            toast.success(status === 'LATE' ? 'Ingreso Tarde registrado.' : 'Ingreso Correcto.');
            onClose();
        } catch (e: any) { toast.error('Error al procesar relevo: ' + (e?.message || e?.code || String(e))); }
    };

    return (
        <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in zoom-in-95">
            <div className="bg-white w-full max-w-md rounded-xl shadow-2xl overflow-hidden">
                <div className={`p-4 text-white flex justify-between items-center ${status === 'LATE' ? 'bg-amber-500' : 'bg-emerald-600'}`}>
                    <h3 className="font-black uppercase flex items-center gap-2">
                        {status === 'LATE' ? <Clock size={20}/> : <UserCheck size={20}/>}
                        {status === 'LATE' ? 'Llegada Tarde' : 'Ingreso A Tiempo'}
                    </h3>
                    <button onClick={onClose}><X size={20}/></button>
                </div>
                <div className="p-6">
                    {/* Info del turno */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4 space-y-1">
                        <div className="flex items-center gap-2">
                            <MapPin size={13} className="text-indigo-500 shrink-0"/>
                            <span className="text-xs font-black text-slate-800 truncate">{incomingShift.objectiveName || '—'}</span>
                            {incomingShift.clientName && <span className="text-[10px] text-slate-400 truncate">· {incomingShift.clientName}</span>}
                        </div>
                        <div className="flex items-center gap-2 pl-5">
                            <span className="text-[10px] font-bold text-indigo-600">{incomingShift.positionName || '—'}</span>
                            <span className="text-slate-300">·</span>
                            <span className="text-[10px] font-mono text-slate-600">{formatTimeRange(incomingShift.shiftDateObj, incomingShift.endDateObj)}</span>
                            <span className="text-[9px] text-slate-400">· {positionCapacity} pax</span>
                        </div>
                    </div>

                    {/* CASO: turno cubierto o >60 min → ofrecer intercambio */}
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
                                className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2">
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
                    <p className="text-sm text-slate-600 mb-4">
                        El guardia <b>{incomingShift.employeeName}</b> está listo para ingresar.
                        {status === 'LATE' && <span className="block mt-1 text-amber-600 font-bold">⚠️ Retraso de {Math.round(diffMin)} minutos.</span>}
                        {mustRelevar && <span className="block mt-1 text-rose-600 font-bold text-xs">Puesto al tope ({activeGuards.length}/{positionCapacity}). Relevá a un guardia activo.</span>}
                    </p>
                    {activeGuards.length > 0 ? (
                        <div className="space-y-2 mb-4">
                            <p className="text-xs font-bold text-slate-400 uppercase">Seleccioná a quién relevar — ordenado por tiempo trabajado:</p>
                            {activeGuards.map((s: any) => {
                                const minutesWorked = s.totalMinutesWorked ?? 0;
                                const hoursWorked = (minutesWorked / 60).toFixed(1);
                                const isOver12h = minutesWorked >= 12 * 60;
                                return (
                                    <button key={s.id} onClick={() => handleConfirm(s.id)}
                                        className={`w-full p-3 border rounded-xl hover:bg-slate-50 flex justify-between items-center group ${s.isRetention ? 'border-orange-300 bg-orange-50/40' : isOver12h ? 'border-red-200 bg-red-50/30' : ''}`}>
                                        <div className="text-left">
                                            <div className="flex items-center gap-2">
                                                <span className="block text-xs font-bold text-slate-700">{s.employeeName}</span>
                                                {s.isRetention && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-orange-500 text-white animate-pulse">EN RETENCIÓN {s.retentionMinutes > 0 ? `+${s.retentionMinutes}min` : ''}</span>}
                                                {isOver12h && !s.isRetention && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">+12h</span>}
                                            </div>
                                            <span className="block text-[10px] text-slate-400">
                                                Salida: {formatTimeSimple(s.endDateObj)} · {hoursWorked}h trabajadas
                                            </span>
                                        </div>
                                        <span className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded text-slate-600 group-hover:bg-slate-800 group-hover:text-white transition-colors">RELEVAR</span>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-center mb-4">
                            <p className="text-xs text-slate-400 italic">No hay guardia saliente registrado.</p>
                        </div>
                    )}
                    {!mustRelevar && (
                        <button onClick={() => handleConfirm(null)} className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-colors">
                            {activeGuards.length > 0 ? 'INGRESAR SIN RELEVAR' : 'CONFIRMAR INGRESO'}
                        </button>
                    )}
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
        } catch (e: any) { toast.error('Error al iniciar protocolo: ' + (e?.message || e?.code || String(e))); }
    };
    return ( <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4"> <div className="bg-white w-full max-w-md rounded-xl shadow-sm overflow-hidden"> <div className={`p-4 text-white flex justify-between items-center ${isAlone ? 'bg-purple-600' : 'bg-emerald-600'}`}> <h3 className="font-black uppercase flex items-center gap-2"><Siren size={20}/> Baja Anticipada</h3> <button onClick={onClose}><X size={20}/></button> </div> <div className="p-6"> <div className={`p-4 rounded-xl border mb-4 ${isAlone ? 'bg-purple-50 border-purple-100' : 'bg-emerald-50 border-emerald-100'}`}> <h4 className={`font-bold text-sm mb-1 ${isAlone ? 'text-purple-800' : 'text-emerald-800'}`}> {isAlone ? '⚠️ GUARDIA SOLO EN EL OBJETIVO' : `✅ HAY ${colleagues.length} COMPAÑEROS`} </h4> <p className="text-xs text-slate-500"> {isAlone ? 'El puesto quedará descubierto. Se requiere activar protocolo.' : 'El puesto puede ser cubierto por la dotación actual.'} </p> </div> {isAlone ? ( <button onClick={handleProtocol} className="w-full py-3 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 animate-pulse shadow-lg shadow-purple-200"> INICIAR PROTOCOLO DE COBERTURA </button> ) : ( <button onClick={handleLog} className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-200"> REGISTRAR NOVEDAD (CUBIERTO) </button> )} </div> </div> </div> );
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
        ? <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">★ Conoce el puesto</span>
        : expLv === 2
            ? <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">Obj. asignado</span>
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

    // 2. ADELANTO: solo el turno siguiente más próximo en el mismo objetivo/posición
    const adelanto = logic.processedData.filter((s: any) =>
        !s.isPresent && !s.isCompleted && !s.isAbsent && !s.isUnassigned && !s.isFranco &&
        s.objectiveId === absenceShift.objectiveId &&
        s.positionName === absenceShift.positionName &&
        toDate(s.shiftDateObj) > now
    ).sort((a: any, b: any) => toDate(a.shiftDateObj).getTime() - toDate(b.shiftDateObj).getTime()).slice(0, 1);

    // Helper de experiencia: nivel según datos del empleado
    const experienceLevel = (e: any): number => {
        if (e.preferredObjectiveId === absenceShift.objectiveId) return 3; // objetivo preferido = experiencia directa
        if (e.objectiveId          === absenceShift.objectiveId) return 2; // objetivo asignado actual
        if (e.clientId             === absenceShift.clientId)    return 1; // mismo cliente
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
        .filter((e: any) => !busyIds.has(e.id) && !isRestricted(e)) // ← excluir restringidos
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
            if (emp && isRestricted(emp)) return false; // ← excluir restringidos
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
            batch.update(doc(db, 'turnos', absenceShift.id), {
                status:                'COVERED',
                resolvedBy:            'OPERACIONES',
                coverageType,                           // RETENTION | EARLY_START | RETEN | FRANCO
                coveredAt:             serverTimestamp(),
                coveredByEmployeeId:   covEmpId,        // quién cubrió
                coveredByEmployeeName: covEmpName,      // nombre para mostrar en planificación
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
            // adjustedStartTime = inicio del turno a cubrir (no la hora actual)
            // El guardia cobra desde el inicio de la vacante aunque llegue tarde
            const vacancyStart = absenceShift.shiftDateObj instanceof Date
                ? Timestamp.fromDate(absenceShift.shiftDateObj)
                : Timestamp.fromDate(toDate(absenceShift.shiftDateObj));
            batch.update(doc(db, 'turnos', s.id), { adjustedStartTime: vacancyStart, isEarlyStart: true });
            batch.set(doc(collection(db, 'user_notifications')), stampEmpresaId({ userId: s.employeeId, type: 'ADELANTO', title: 'Turno adelantado', read: false, body: `Tu turno en ${absenceShift.objectiveName} fue adelantado. Confirmá llegada.`, objectiveId: absenceShift.objectiveId, shiftId: s.id, createdAt: serverTimestamp() }, tenantId(s)));
            markCoverageResolved(batch, 'EARLY_START', s);
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
            const slotStart = toDate(absenceShift.shiftDateObj);
            const eightHoursLater = new Date(now.getTime() + 8 * 3600000);
            const endTime = eightHoursLater > absenceEnd ? eightHoursLater : absenceEnd;
            const empName = emp.fullName || emp.name || '';
            const newRef = doc(collection(db, 'turnos'));
            const batch = writeBatch(db);
            batch.set(newRef, stampEmpresaId({ employeeId: emp.id, employeeName: empName, clientId: absenceShift.clientId, clientName: absenceShift.clientName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, positionName: absenceShift.positionName, startTime: Timestamp.fromDate(slotStart), endTime: Timestamp.fromDate(endTime), status: 'PENDING', origin: 'RETEN', isReten: true, absenceShiftId: absenceShift.id, createdAt: serverTimestamp() }, tenantId(absenceShift)));
            batch.set(doc(collection(db, 'user_notifications')), stampEmpresaId({ userId: emp.id, type: 'RETEN', title: 'Convocatoria de Retén', read: false, body: `Sos convocado como retén en ${absenceShift.objectiveName} (${absenceShift.positionName}).`, objectiveId: absenceShift.objectiveId, shiftId: newRef.id, createdAt: serverTimestamp() }, tenantId(absenceShift)));
            markCoverageResolved(batch, 'RETEN', { id: emp.id, fullName: empName });
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
            const batch = writeBatch(db);
            batch.update(doc(db, 'turnos', s.id), { isFrancoTrabajado: true, francoTrabajadoAt: serverTimestamp(), francoObjectiveId: absenceShift.objectiveId, francoObjectiveName: absenceShift.objectiveName });
            batch.set(doc(collection(db, 'user_notifications')), stampEmpresaId({ userId: s.employeeId, type: 'FRANCO_TRABAJADO', title: 'Franco trabajado', read: false, body: `Se te convoca a trabajar tu franco en ${absenceShift.objectiveName}.`, objectiveId: absenceShift.objectiveId, shiftId: s.id, createdAt: serverTimestamp() }, tenantId(s)));
            markCoverageResolved(batch, 'FRANCO', s);
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
                <div className="bg-white w-full max-w-xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
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
            <WAComposeModal isOpen={localWa.isOpen} onClose={() => setLocalWa(d => ({...d, isOpen: false}))} ctx={localWa.ctx}/>
        </>
    );
};

const RetentionModal = ({ isOpen, onClose, retainedShift }: any) => { if (!isOpen) return null; return ( <div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4 animate-in fade-in"> <div className="bg-white w-full max-w-sm rounded-xl shadow-sm p-6"> <h3 className="font-bold mb-2">Retención de Guardia</h3> <p className="text-sm text-slate-500 mb-4">{retainedShift?.employeeName || 'Guardia'}</p> <button onClick={onClose} className="w-full py-2 bg-slate-100 rounded font-bold">Cerrar</button> </div> </div> ); };
const CheckOutModal = ({ isOpen, onClose, onConfirm, employeeName }: any) => { const [novedad, setNovedad] = useState(''); if (!isOpen) return null; return (<div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-xl shadow-sm p-6"><h3 className="font-bold mb-4">Salida: {employeeName}</h3><button onClick={() => { onConfirm(false); onClose(); }} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold mb-2">Salida Normal</button><textarea className="w-full p-2 border rounded mb-2" placeholder="Novedad..." value={novedad} onChange={e=>setNovedad(e.target.value)}/><button onClick={() => { onConfirm(novedad); setNovedad(''); onClose(); }} className="w-full py-2 bg-slate-100 font-bold rounded">Reportar y Salir</button><button onClick={onClose} className="mt-2 text-sm text-slate-400 w-full">Cancelar</button></div></div>); };
const AttendanceModal = ({ isOpen, onClose, shift, onMarkAbsent }: any) => { if (!isOpen) return null; return (<div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-xl shadow-sm p-6 text-center"><AlertTriangle size={48} className="mx-auto text-amber-500 mb-4"/><h3 className="font-bold text-lg mb-2">Confirmar Ausencia</h3><p className="text-sm text-slate-500 mb-6">¿{shift?.employeeName} no se presentó?</p><button onClick={() => onMarkAbsent(shift)} className="w-full py-3 bg-rose-600 text-white rounded-xl font-bold mb-2">MARCAR AUSENTE</button><button onClick={onClose} className="text-sm text-slate-400">Cancelar</button></div></div>); };
const WorkedDayOffModal = ({ isOpen, onClose, shift }: any) => { if (!isOpen) return null; return (<div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-xl shadow-sm p-6"><h3 className="font-bold">Franco Trabajado</h3><button onClick={onClose} className="w-full mt-4 py-2 bg-slate-100 rounded">Cerrar</button></div></div>); };

const GuardCard = ({ shift, viewTab, onOpenCheckout, onOpenAttendance, onOpenHandover, onOpenInterrupt, onOpenCoverage, onReportPlanning, onOpenWorkedFranco, onNovedadAbsence, onOpenWA, isCompact, isAutoMode, onRevertAbsence }: any) => {
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

    let name = shift.isUnassigned ? (shift.employeeName || 'VACANTE') : (shift.employeeName || 'Desconocido');
    if (shift.isReportedToPlanning) name = name.replace('VACANTE: ', '');

    // Badge de estado
    let badge = null;
    if (shift.isReportedToPlanning)  badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-600 text-white flex items-center gap-0.5 shrink-0"><CornerUpLeft size={8}/> DEVUELTO</span>;
    else if (shift.isUnassigned)     badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-600 text-white shrink-0">SIN CUBRIR</span>;
    else if (shift.isRetention)      badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-orange-500 text-white animate-pulse shrink-0 flex items-center gap-0.5"><Clock size={8}/>RECARGO {shift.retentionMinutes > 0 ? `+${shift.retentionMinutes}min` : ''}</span>;
    else if (shift.isPotentialAbsence) badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-red-600 text-white animate-pulse shrink-0">AUSENCIA</span>;
    else if (shift.isLateNotified)   badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500 text-white animate-pulse shrink-0 flex items-center gap-0.5">⏱ LLEGÓ TARDE {shift.minutesRemainingLate != null ? `· ${shift.minutesRemainingLate}min` : ''}</span>;
    else if (shift.isLateUnnotified) badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-400 text-white shrink-0">TARDE</span>;
    else if (shift.isPresent)        badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-600 text-white shrink-0 flex items-center gap-0.5"><Clock size={8}/>ACTIVO {elapsedInShift ? elapsedInShift : ''}</span>;
    else if (shift.isEarlyStart || shift.isAwaitingCoverageCheckIn) badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-indigo-600 text-white animate-pulse shrink-0 flex items-center gap-0.5"><PlayCircle size={8}/>{shift.isEarlyStart ? 'ADELANTADO' : 'CONVOCADO'}</span>;
    else if (shift.isAbsent)         badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-700 text-white shrink-0">AUSENTE</span>;
    else if (shift.isResolvedByOps)  badge = <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-indigo-600 text-white shrink-0">OPS</span>;

    if (isCompact) return (
        <div className={`relative flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200/80 mb-1 shadow-sm hover:shadow-md transition-all ${rowBg}`}>
            <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${accentColor}`}/>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ml-1 ${shift.isUnassigned && !shift.isReportedToPlanning ? 'bg-rose-100 text-rose-600' : 'bg-slate-200 text-slate-600'}`}>
                {shift.isUnassigned && !shift.isReportedToPlanning ? '!' : (name[0] || '?')}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 leading-tight">
                    <span className={`text-[11px] font-black truncate ${shift.isUnassigned && !shift.isReportedToPlanning ? 'text-rose-600' : 'text-slate-800'}`}>{name}</span>
                    {badge}
                </div>
                <div className="flex items-center gap-1.5 text-[9px] text-slate-400 leading-tight mt-0.5">
                    <span className="truncate">{shift.objectiveName} · <span className="text-indigo-500">{shift.positionName}</span></span>
                    <span className={`shrink-0 font-bold ${isSameDay(shift.shiftDateObj, now) ? 'text-slate-400' : 'text-amber-500'}`}>{isSameDay(shift.shiftDateObj, now) ? 'HOY' : formatDateShort(shift.shiftDateObj)}</span>
                    <span className="shrink-0 font-mono">{formatTimeRange(shift.shiftDateObj, shift.endDateObj)}</span>
                </div>
            </div>
            <div className="flex gap-1 shrink-0">
                {!shift.isUnassigned && (<button onClick={() => onOpenWA(shift)} className={`p-1.5 border rounded-lg hover:bg-emerald-100 transition-colors ${shift.phone ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`} title={shift.phone ? 'WhatsApp' : 'Sin teléfono'}><MessageCircle size={12}/></button>)}
                {canCover && viewTab === 'VACANTES' && (<><button onClick={() => onOpenCoverage(shift)} className="p-1.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors" title="Cubrir"><Siren size={12}/></button><button onClick={handleReport} className="p-1.5 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors" title="Devolver a planificación"><CornerUpLeft size={12}/></button></>)}
                {shift.isReportedToPlanning && viewTab === 'VACANTES' && (<span className="text-[9px] font-bold text-slate-500 uppercase px-1 shrink-0">Devuelto</span>)}
                {viewTab === 'PLAN' && (<><button onClick={() => onOpenHandover(shift)} disabled={!canCheckIn} className={`p-1.5 rounded-lg transition-colors ${canCheckIn ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`} title="Dar presente"><PlayCircle size={12}/></button><button onClick={() => onOpenAttendance(shift)} className="p-1.5 bg-amber-50 text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors" title="Marcar ausente"><AlertTriangle size={12}/></button></>)}
                {(viewTab === 'PRIORIDAD' || viewTab === 'NO_LLEGO') && canCheckIn && !shift.isPresent && (
                    <button onClick={() => onOpenHandover(shift)} className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors" title="Dar presente"><PlayCircle size={12}/></button>
                )}
                {(viewTab === 'ACTIVOS' || viewTab === 'RETENIDOS') && (<><button onClick={() => onOpenCheckout(shift)} className="p-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors" title="Salida"><LogOut size={12}/></button><button onClick={() => onOpenInterrupt(shift)} className="p-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors" title="Baja anticipada"><Siren size={12}/></button></>)}
                {viewTab === 'AUSENTES' && (shift.isAbsent
                    ? (() => {
                        const endMs = shift.endDateObj?.getTime?.() ?? 0;
                        const shiftEnded = endMs > 0 && Date.now() > endMs;
                        return shiftEnded
                            ? <span className="text-[9px] px-2 py-1 rounded bg-slate-100 text-slate-400 font-bold">VENCIDO</span>
                            : <div className="flex gap-1">
                                <button onClick={() => onOpenHandover(shift)} className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors" title="Guardia llegó tarde — dar presente"><UserCheck size={12}/></button>
                                <button onClick={() => onOpenCoverage(shift)} className="p-1.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors" title="Protocolo cobertura"><Siren size={12}/></button>
                                <button onClick={() => onRevertAbsence && onRevertAbsence(shift)} className="p-1.5 bg-slate-50 text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors" title="Revertir ausencia — error de sistema"><XCircle size={12}/></button>
                              </div>;
                      })()
                    : <button onClick={() => onOpenAttendance(shift)} className="p-1.5 bg-amber-50 text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors" title="Confirmar ausencia"><AlertTriangle size={12}/></button>
                )}
            </div>
        </div>
    );

    // ── Vista expandida ──────────────────────────────────────────────
    return (
        <div className={`relative rounded-xl border border-slate-200 mb-2 shadow-sm overflow-hidden transition-all ${rowBg}`}>
            <div className={`h-1 w-full ${accentColor}`}/>
            <div className="px-3 pt-2.5 pb-1.5">
                {/* Fila 1: nombre + badge + hora */}
                <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 ${shift.isUnassigned && !shift.isReportedToPlanning ? 'bg-rose-100 text-rose-600' : 'bg-slate-200 text-slate-600'}`}>
                            {shift.isUnassigned && !shift.isReportedToPlanning ? '!' : (name[0] || '?')}
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
                    <span className="text-indigo-600 font-bold truncate">{shift.positionName}</span>
                    <span className="ml-auto font-mono text-slate-600 shrink-0 flex items-center gap-1">
                        <span className={`font-bold not-font-mono text-[9px] ${isSameDay(shift.shiftDateObj, now) ? 'text-slate-400' : 'text-amber-500'}`}>{isSameDay(shift.shiftDateObj, now) ? 'HOY' : formatDateShort(shift.shiftDateObj)}</span>
                        {formatTimeRange(shift.shiftDateObj, shift.endDateObj)}
                    </span>
                </div>
                {/* Fila 3: botones con texto */}
                <div className="flex gap-1.5 flex-wrap pl-10">
                    {!shift.isUnassigned && (<button onClick={() => onOpenWA(shift)} className={`flex items-center gap-1 px-2.5 py-1.5 border rounded-lg text-[10px] font-bold hover:bg-emerald-100 transition-colors ${shift.phone ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}><MessageCircle size={11}/>WA</button>)}
                    {canCover && viewTab === 'VACANTES' && (<>
                        <button onClick={() => onOpenCoverage(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-600 text-white rounded-lg text-[10px] font-bold hover:bg-rose-700 transition-colors"><Siren size={11}/>CUBRIR</button>
                        <button onClick={handleReport} className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-700 text-white rounded-lg text-[10px] font-bold hover:bg-slate-800 transition-colors"><CornerUpLeft size={11}/>DEVOLVER</button>
                    </>)}
                    {shift.isReportedToPlanning && viewTab === 'VACANTES' && (<span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1 px-2 py-1.5"><CornerUpLeft size={10}/>Devuelto</span>)}
                    {viewTab === 'PLAN' && (<>
                        <button onClick={() => onOpenHandover(shift)} disabled={!canCheckIn} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${canCheckIn ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}><PlayCircle size={11}/>DAR PRESENTE</button>
                        {diff >= 5
                            ? <button onClick={() => onOpenAttendance(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-[10px] font-bold hover:bg-amber-100 transition-colors"><AlertTriangle size={11}/>AUSENTE</button>
                            : <button onClick={() => onNovedadAbsence(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-sky-50 text-sky-700 border border-sky-200 rounded-lg text-[10px] font-bold hover:bg-sky-100 transition-colors"><BellRing size={11}/>NOVEDAD</button>
                        }
                    </>)}
                    {(viewTab === 'PRIORIDAD' || viewTab === 'NO_LLEGO') && canCheckIn && !shift.isPresent && (
                        <button onClick={() => onOpenHandover(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-bold hover:bg-indigo-700 transition-colors"><PlayCircle size={11}/>DAR PRESENTE</button>
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
                                : <div className="flex gap-1.5">
                                    <button onClick={() => onOpenHandover(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-bold hover:bg-indigo-700 transition-colors" title="Guardia llegó tarde"><UserCheck size={11}/>LLEGÓ TARDE</button>
                                    <button onClick={() => onOpenCoverage(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-600 text-white rounded-lg text-[10px] font-bold hover:bg-rose-700 transition-colors"><Siren size={11}/>CUBRIR</button>
                                  </div>;
                          })()
                        : <button onClick={() => onOpenAttendance(shift)} className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-[10px] font-bold hover:bg-amber-100 transition-colors"><AlertTriangle size={11}/>CONFIRMAR AUSENCIA</button>
                    )}
                </div>
            </div>
        </div>
    );
};

const ObjectiveGroup = ({ group, modals, isCompact, onReport, viewTab, onOpenWorkedFranco, onNovedadAbsence, onOpenWA, isAutoMode, isPublished }: any) => {
    const [expanded, setExpanded] = useState(true);
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
                    {group.items.map((s: any) => (
                        <GuardCard key={s.id} shift={s} viewTab={viewTab} isCompact={isCompact} isAutoMode={isAutoMode}
                            onOpenCheckout={(s: any) => modals.setCheckoutData({ isOpen: true, shift: s })}
                            onOpenAttendance={(s: any) => modals.setAttendanceData({ isOpen: true, shift: s })}
                            onOpenHandover={(s: any) => modals.setHandoverData({ isOpen: true, shift: s })}
                            onOpenInterrupt={(s: any) => modals.setInterruptData({ isOpen: true, shift: s })}
                            onOpenCoverage={(s: any) => modals.setCoverageData({ isOpen: true, shift: s })}
                            onReportPlanning={onReport} onOpenWorkedFranco={onOpenWorkedFranco}
                            onNovedadAbsence={onNovedadAbsence} onOpenWA={onOpenWA}/>
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
    const { assignedClientId } = useAuth();
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = !!(empresa as any)?.migracionCompleta;
    const logic = useOperacionesMonitor(assignedClientId);
    const session = useOperatorSession();
    const elapsed = useElapsedTime(session.mySession?.startTime || null);
    useAutoMonitor({
        isActive: true,
        isAutoMode: session.isAutoMode,
        empresaId,
        activeOperatorId: session.mySession?.operatorId || null,
        processedData: logic.processedData,
    });
    const [isExternalMap, setIsExternalMap] = useState(false);
    const [mapCollapsed, setMapCollapsed] = useState(false);
    const [showCoverageGrid, setShowCoverageGrid] = useState(false);
    const [confirmEndSession, setConfirmEndSession] = useState(false);
    const [checkoutData, setCheckoutData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [attendanceData, setAttendanceData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [handoverData, setHandoverData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [interruptData, setInterruptData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [coverageData, setCoverageData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [workedFrancoData, setWorkedFrancoData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [waData, setWaData] = useState<{ isOpen: boolean; ctx: WAComposeContext }>({ isOpen: false, ctx: { employeeName: '', phone: '' } });
    const [isGrouped, setIsGrouped] = useState(true);
    const [viewMode, setViewMode] = useState<'objetivos' | 'lista'>('objetivos'); // default: vista por objetivo
    const [expandedObjectiveId, setExpandedObjectiveId] = useState<string | null>(null);
    const [bitacoraTab, setBitacoraTab] = useState<'reciente'|'operaciones'|'alertas'>('reciente');
    const [bitacoraOpen, setBitacoraOpen] = useState(false);
    const [empNovedades, setEmpNovedades] = useState<any[]>([]);
    const [notifPanelOpen, setNotifPanelOpen] = useState(false);
    const [authorizedAbsences, setAuthorizedAbsences] = useState<any[]>([]);
    const [absencesPanelOpen, setAbsencesPanelOpen] = useState(true);

    const recentAtendidas = useMemo(() =>
        empNovedades.filter(n => n.status === 'ATENDIDA' || n.status === 'atendida').slice(0, 8),
    [empNovedades]);

    const COVERAGE_GRACE_MINUTES = 60; // tiempo de gracia para gestionar cobertura

    const pendingNovedades = useMemo(() => {
        const now = Date.now();
        return empNovedades.filter(n => {
            if (n.status === 'ATENDIDA' || n.status === 'atendida') return false;
            if (n.type === 'VACANTE_A_PLANIFICACION') return false; // auto-procesada

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
        const unsub = onSnapshot(
            novedadesQ,
            snap => {
                const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                docs.sort((a: any, b: any) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
                setEmpNovedades(docs);
            }
        );
        return () => unsub();
    }, [empresaId, empresa]);

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
        const unsub = onSnapshot(
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
            }
        );
        return () => unsub();
    }, [empresaId, empresa]);

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

    const OPS_ACTIONS = new Set(['CHECKIN','CHECKOUT','MARK_ABSENT','HANDOVER','INTERRUPT','COVERAGE','WORKED_FRANCO','ATTENDANCE','REPORT_PLANNING','REPORTE','RETENCION','PRESENTE','AUSENTE','SALIDA','ENTRADA','CHECK_IN','CHECK_OUT','MANUAL_ATTENDANCE','VACANCY']);
    const filteredBitacora = useMemo(() => {
        const logs = logic.recentLogs.filter((l: any) => l.formattedActor !== 'VACANTE');
        if (bitacoraTab === 'reciente') return logs.slice(0, 20);
        return logs.filter((l: any) => {
            const a = (l.action || '').toUpperCase();
            return OPS_ACTIONS.has(a) || a.includes('CHECK') || a.includes('GUARD') || a.includes('TURNO') || a.includes('SHIFT') || a.includes('ABSENT') || a.includes('HANDOVER') || a.includes('COVERAGE') || a.includes('FRANCO') || a.includes('INTERRUPT');
        });
    }, [logic.recentLogs, bitacoraTab]);

    const mapWindowRef = useRef<Window | null>(null);
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
    const generateDailyReport = () => {
        const pdf = new jsPDF();
        const now = new Date();
        const tz  = 'America/Argentina/Cordoba';
        const fmt24 = (d: any) => { try { return toDate(d).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', hour12: false, timeZone: tz }); } catch { return '--:--'; } };
        const fmtDT = (d: Date) => d.toLocaleString('es-AR', { timeZone: tz, day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12: false });
        const fmtDateLong = (d: Date) => d.toLocaleDateString('es-AR', { timeZone: tz, weekday:'long', day:'2-digit', month:'long', year:'numeric' });
        const operatorName = session.activeSession?.operatorName || 'Sistema Automático';
        const guardStart   = session.activeSession?.startTime ? fmtDT(session.activeSession.startTime) : 'No registrado';
        const reportTime   = fmtDT(now);
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();

        // ── Helpers de sección ───────────────────────────────────────────
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
        const kv = (label: string, value: string) => [label, value];

        // Datos base del día
        const todayShifts    = logic.processedData.filter((s: any) => isSameDay(s.shiftDateObj, now));
        const completedToday = todayShifts.filter((s: any) => s.isCompleted || s.status === 'COMPLETED');
        const activeNow      = todayShifts.filter((s: any) => s.isPresent && !s.isCompleted);
        const retainedNow    = todayShifts.filter((s: any) => s.isRetention);
        const vacantToday    = todayShifts.filter((s: any) => s.isUnassigned);
        const absentToday    = todayShifts.filter((s: any) => s.isAbsent || s.isPotentialAbsence);
        const distinctObjs   = new Set(todayShifts.map((s:any)=>s.objectiveId).filter(Boolean));
        const coveredObjs    = new Set(todayShifts.filter((s:any)=>s.isPresent||s.isCompleted).map((s:any)=>s.objectiveId).filter(Boolean));
        const totalPlanHrs   = todayShifts.filter((s:any)=>!s.isUnassigned).reduce((a:number,s:any)=>{ try{ return a+Math.max(0,(toDate(s.endDateObj).getTime()-toDate(s.shiftDateObj).getTime())/3600000); }catch{return a;} },0);
        const totalRealHrs   = completedToday.reduce((a:number,s:any)=>{ const rs=s.realStartTime?.seconds?new Date(s.realStartTime.seconds*1000):null; const re=s.realEndTime?.seconds?new Date(s.realEndTime.seconds*1000):null; if(rs&&re){const h=(re.getTime()-rs.getTime())/3600000; return h>0&&h<=36?a+h:a+((toDate(s.endDateObj).getTime()-toDate(s.shiftDateObj).getTime())/3600000);} return a+((toDate(s.endDateObj).getTime()-toDate(s.shiftDateObj).getTime())/3600000); },0);
        const totalOpShifts  = logic.stats.plan + logic.stats.activos + logic.stats.retenidos + logic.stats.vacantes + logic.stats.ausentes;
        // Cobertura por turnos (no por objetivos): cuántos turnos tienen guardia vs total planificado
        const coveredShifts  = completedToday.length + activeNow.length + retainedNow.length;
        const coveragePct    = totalOpShifts > 0 ? Math.round((coveredShifts / totalOpShifts) * 100) : 0;
        // Logs operativos para PDF: siempre filtrado por acciones de operaciones, independiente del tab activo
        const pdfOpsLogs = logic.recentLogs.filter((l: any) => {
            if (l.formattedActor === 'VACANTE') return false;
            const a = (l.action || '').toUpperCase();
            return OPS_ACTIONS.has(a) || a.includes('CHECK') || a.includes('GUARD') || a.includes('TURNO') || a.includes('SHIFT') || a.includes('ABSENT') || a.includes('HANDOVER') || a.includes('COVERAGE') || a.includes('FRANCO') || a.includes('INTERRUPT');
        });
        const punctualCount  = completedToday.filter((s:any)=>{ const rs=s.realStartTime?.seconds?new Date(s.realStartTime.seconds*1000):null; if(!rs)return true; return (rs.getTime()-toDate(s.shiftDateObj).getTime())/60000<=5; }).length;
        const punctualPct    = completedToday.length > 0 ? Math.round((punctualCount/completedToday.length)*100) : 100;
        const hasIncidents   = (absentToday.length + vacantToday.length + retainedNow.length) > 0;
        const statusLabel    = hasIncidents ? 'CON INCIDENCIAS' : 'NORMAL';

        // ════════════════════════════════════════════════════════════════
        // PÁGINA 1 — PORTADA
        // ════════════════════════════════════════════════════════════════
        pdf.setFillColor(15, 23, 42);
        pdf.rect(0, 0, pageW, pageH * 0.45, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(28); pdf.setFont('helvetica', 'bold');
        pdf.text('INFORME DE GUARDIA', pageW / 2, 50, { align: 'center' });
        pdf.setFontSize(13); pdf.setFont('helvetica', 'normal');
        pdf.text('Centro de Operaciones de Seguridad Privada', pageW / 2, 62, { align: 'center' });
        pdf.setFontSize(10);
        pdf.text(fmtDateLong(now).toUpperCase(), pageW / 2, 76, { align: 'center' });

        // Badge estado
        const badgeColor: [number,number,number] = hasIncidents ? [220,38,38] : [5,150,105];
        pdf.setFillColor(...badgeColor);
        pdf.roundedRect(pageW/2 - 30, 84, 60, 10, 2, 2, 'F');
        pdf.setFontSize(9); pdf.setFont('helvetica', 'bold');
        pdf.text(statusLabel, pageW / 2, 91, { align: 'center' });

        pdf.setTextColor(0, 0, 0);
        pdf.setFontSize(10); pdf.setFont('helvetica', 'normal');
        const infoY = pageH * 0.45 + 16;
        const col1 = 30, col2 = pageW / 2 + 10;
        pdf.setFont('helvetica', 'bold'); pdf.text('OPERADOR:', col1, infoY);
        pdf.setFont('helvetica', 'normal'); pdf.text(operatorName, col1 + 28, infoY);
        pdf.setFont('helvetica', 'bold'); pdf.text('INICIO GUARDIA:', col1, infoY + 8);
        pdf.setFont('helvetica', 'normal'); pdf.text(guardStart, col1 + 38, infoY + 8);
        pdf.setFont('helvetica', 'bold'); pdf.text('CIERRE / REPORTE:', col1, infoY + 16);
        pdf.setFont('helvetica', 'normal'); pdf.text(reportTime, col1 + 42, infoY + 16);
        pdf.setFont('helvetica', 'bold'); pdf.text('TURNOS CUBIERTOS:', col2, infoY);
        pdf.setFont('helvetica', 'normal'); pdf.text(`${coveredShifts} / ${totalOpShifts} (${coveragePct}%)`, col2 + 46, infoY);
        pdf.setFont('helvetica', 'bold'); pdf.text('TURNOS DEL DÍA:', col2, infoY + 8);
        pdf.setFont('helvetica', 'normal'); pdf.text(String(totalOpShifts), col2 + 38, infoY + 8);
        pdf.setFont('helvetica', 'bold'); pdf.text('HORAS PLANIFICADAS:', col2, infoY + 16);
        pdf.setFont('helvetica', 'normal'); pdf.text(`${totalPlanHrs.toFixed(1)} hs`, col2 + 48, infoY + 16);

        // ════════════════════════════════════════════════════════════════
        // PÁGINA 2 — RESUMEN EJECUTIVO (KPIs)
        // ════════════════════════════════════════════════════════════════
        const y2 = sectionHeader('RESUMEN EJECUTIVO', 30, 64, 175);
        autoTable(pdf, {
            head: [['INDICADOR', 'VALOR', 'INDICADOR', 'VALOR']],
            body: [
                ['Turnos planificados hoy',  String(totalOpShifts),        'Guardias presentes',          String(logic.stats.activos)],
                ['Turnos completados',        String(completedToday.length),'Retenciones activas',         String(logic.stats.retenidos)],
                ['Vacantes sin cubrir',       String(logic.stats.vacantes), 'Ausencias registradas',       String(absentToday.length)],
                ['Objetivos con cobertura',   `${coveredObjs.size} / ${distinctObjs.size}`,'% Turnos cubiertos', `${coveragePct}%`],
                ['Horas planificadas',        `${totalPlanHrs.toFixed(1)} hs`,'Horas reales (completados)', `${totalRealHrs.toFixed(1)} hs`],
                ['Índice de puntualidad',     `${punctualPct}%`,            'Alertas gestionadas',         String(empNovedades.filter((n:any)=>n.status==='ATENDIDA').length)],
                ['Alertas pendientes',        String(pendingNovedades.length),'Estado de guardia',          statusLabel],
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
                if (data.section==='body' && data.column.index===3 && data.cell.raw===statusLabel && hasIncidents) {
                    data.cell.styles.textColor = [220,38,38]; data.cell.styles.fontStyle = 'bold';
                }
                if (data.section==='body' && data.column.index===3 && String(data.cell.raw).endsWith('%') && parseInt(String(data.cell.raw))<80) {
                    data.cell.styles.textColor = [220,38,38];
                }
            },
        });

        // ════════════════════════════════════════════════════════════════
        // PÁGINA 3 — TURNOS COMPLETADOS
        // ════════════════════════════════════════════════════════════════
        const y3 = sectionHeader('TURNOS COMPLETADOS', 5, 150, 105);
        const completedRows = completedToday
            .sort((a:any,b:any) => toDate(a.shiftDateObj).getTime()-toDate(b.shiftDateObj).getTime())
            .map((s: any) => {
                const planS  = toDate(s.shiftDateObj);
                const planE  = toDate(s.endDateObj);
                const realS  = s.realStartTime?.seconds ? new Date(s.realStartTime.seconds*1000) : null;
                const realE  = s.realEndTime?.seconds   ? new Date(s.realEndTime.seconds*1000)   : null;
                const planHr = ((planE.getTime()-planS.getTime())/3600000).toFixed(1);
                const realHr = (realS&&realE) ? ((realE.getTime()-realS.getTime())/3600000).toFixed(1) : planHr;
                const lateMin = realS ? Math.round((realS.getTime()-planS.getTime())/60000) : 0;
                const punct   = lateMin > 5 ? `TARDE +${lateMin}m` : 'A TIEMPO';
                return [s.employeeName||'-', s.objectiveName||'-', s.positionName||'-',
                    `${fmt24(planS)} – ${fmt24(planE)}`, `${planHr}h`, `${realHr}h`, punct];
            });
        autoTable(pdf, {
            head: [['Guardia','Objetivo','Posición','Horario Plan.','Hs Plan','Hs Real','Puntualidad']],
            body: completedRows.length>0 ? completedRows : [['—','—','—','Sin turnos completados hoy','—','—','—']],
            startY: y3,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [5,150,105] },
            didParseCell: (data:any) => {
                if (data.column.index===6 && String(data.cell.raw).startsWith('TARDE')) {
                    data.cell.styles.textColor=[217,119,6]; data.cell.styles.fontStyle='bold';
                }
            },
        });

        // ════════════════════════════════════════════════════════════════
        // PÁGINA 4 — BITÁCORA DE OPERACIONES
        // ════════════════════════════════════════════════════════════════
        const y4 = sectionHeader('BITÁCORA DE OPERACIONES', 15, 23, 42);
        const logRows = pdfOpsLogs
            .map((log:any) => [
                fmt24(log.time),
                (log.action||'LOG').replace('MANUAL_',''),
                log.formattedActor||'Sistema',
                log.targetEmployee||'-',
                log.fullDetail||log.details||'-',
            ]);
        autoTable(pdf, {
            head: [['Hora','Evento','Operador','Guardia / Objetivo','Detalle']],
            body: logRows.length>0 ? logRows : [['—','—','—','—','Sin eventos registrados']],
            startY: y4,
            styles: { fontSize: 7.5 },
            headStyles: { fillColor: [15,23,42] },
            columnStyles: { 4: { cellWidth: 65 } },
        });

        // ════════════════════════════════════════════════════════════════
        // PÁGINA 5 — TRATAMIENTO DE ALERTAS
        // ════════════════════════════════════════════════════════════════
        const y5 = sectionHeader('TRATAMIENTO DE ALERTAS', 153, 27, 27);
        const alertTypeLabel = (t:string) => ({
            AUSENCIA_AUTO:'AUSENCIA', VACANTE_PROTOCOLO_COBERTURA:'PROT. COBERTURA',
            VACANTE_A_PLANIFICACION:'VACANTE PLAN', RELEVO_NO_PRESENTADO:'RELEVO',
            VACANTE_NO_CUBIERTA:'SIN CUBRIR', BAJA_CUBIERTA:'BAJA CUBIERTA',
            RETENCION_LARGA:'RETENCIÓN', POSICION_SIN_RELEVO:'SIN RELEVO',
        } as any)[t] || t;
        const pendientesAlerts = empNovedades.filter((n:any)=>n.status!=='ATENDIDA'&&n.status!=='atendida'&&n.type!=='VACANTE_A_PLANIFICACION');
        const atendidasAlerts  = empNovedades.filter((n:any)=>n.status==='ATENDIDA'||n.status==='atendida');
        const alertRows = [...pendientesAlerts, ...atendidasAlerts].map((n:any) => {
            const ts = n.createdAt?.seconds ? new Date(n.createdAt.seconds*1000).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:tz}) : '--';
            const st = (n.status==='ATENDIDA'||n.status==='atendida') ? 'ATENDIDA' : 'PENDIENTE';
            return [ts, alertTypeLabel(n.type), n.objectiveName||'-', n.positionName||'-', n.description||'-', st];
        });
        autoTable(pdf, {
            head: [['Hora','Tipo','Objetivo','Posición','Descripción','Estado']],
            body: alertRows.length>0 ? alertRows : [['—','—','—','—','Sin alertas registradas','—']],
            startY: y5,
            styles: { fontSize: 7.5 },
            headStyles: { fillColor: [153,27,27] },
            columnStyles: { 4:{cellWidth:60}, 5:{cellWidth:22} },
            didParseCell: (data:any) => {
                if (data.column.index===5 && data.cell.raw==='PENDIENTE') {
                    data.cell.styles.textColor=[220,38,38]; data.cell.styles.fontStyle='bold';
                }
            },
        });

        // Pie de página en todas las páginas
        const totalPages = (pdf as any).internal.getNumberOfPages();
        for (let i=1; i<=totalPages; i++) {
            pdf.setPage(i);
            pdf.setFontSize(7); pdf.setFont('helvetica','normal'); pdf.setTextColor(150,150,150);
            pdf.text(`Informe confidencial — ${operatorName} — ${reportTime}`, 14, pageH-6);
            pdf.text(`Página ${i} / ${totalPages}`, pageW-14, pageH-6, { align:'right' });
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
            toast.success(msg);
        } catch (e: any) {
            toast.error('Error al marcar ausencia: ' + (e?.message || e?.code || String(e)));
        }
    };
    const handleVacancyCreated = (newVacancyShift: any) => { setInterruptData({isOpen:false, shift:null}); setCoverageData({isOpen:true, shift: newVacancyShift}); };

    // Revertir ausencia incorrecta (bug sistema o error del operador)
    const handleRevertAbsence = async (shift: any) => {
        if (!confirm(`¿Revertir la ausencia de ${shift.employeeName}?\nSe limpiará el flag de ausencia. Usá esto solo si fue un error.`)) return;
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
    const handleNovedadAbsence = async (shift: any) => {
        if (!confirm(`¿Registrar aviso anticipado de ausencia para ${shift.employeeName}?\nSe notificará a RRHH y Planificación.`)) return;
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
    const handleReportPlanning = async (shift: any) => {
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

    // ── COBERTURA POR OBJETIVO ─────────────────────────────────────────────────
    const coverageByObjective = useMemo(() => {
        const now = new Date();
        const map: Record<string, {name:string; client:string; total:number; active:number; absent:number; vacant:number; objectiveId:string}> = {};
        const hoy = logic.processedData.filter((s:any) =>
            isSameDay(s.shiftDateObj, now) || ((s.isPresent || s.isRetention) && !s.isCompleted)
        );
        hoy.forEach((s:any) => {
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

    // ── VISTA POR OBJETIVO: estado agregado por objetivo, ordenado por criticidad ──
    const objectivesWithAlerts = useMemo(() => {
        const now = new Date();
        const map = new Map<string, any>();
        const hoy = logic.processedData.filter((s: any) =>
            isSameDay(s.shiftDateObj, now) || ((s.isPresent || s.isRetention) && !s.isCompleted)
        );
        hoy.forEach((s: any) => {
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
            else if (s.isOperationalVacancy)               { obj.vacant++;  if (!obj.criticalShift) obj.criticalShift = s; }
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

    const modalSetters = { setCheckoutData, setAttendanceData, setHandoverData, setInterruptData, setCoverageData };
    const tabs = [
        { id: 'PLAN', label: 'PLAN', count: logic.stats.plan, color: 'text-indigo-600' },
        { id: 'ACTIVOS', label: 'ACTIVOS', count: logic.stats.activos, color: 'text-emerald-600' },
        { id: 'RETENIDOS', label: 'RETENIDOS', count: logic.stats.retenidos, color: 'text-orange-600' },
        { id: 'VACANTES', label: 'VACANTES', count: logic.stats.vacantes, color: 'text-slate-800' },
        { id: 'AUSENTES', label: 'AUSENTES', count: logic.stats.ausentes, color: 'text-rose-700' },
        { id: 'FRANCOS', label: 'FRANCOS', count: logic.stats.francos, color: 'text-blue-600' }
    ];

    return (
        <DashboardLayout>
            <Toaster position="top-right" />
            <Head><title>COSP V1.0 | Centro de Operaciones</title></Head>
            <style>{POPUP_STYLES}</style>
            
            {/* ── Banda Estado del Día ── */}
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
                                    {isCrisis ? '⚠ COBERTURA CRÍTICA' : isWarning ? '▲ ATENCIÓN' : 'Estado del día'}
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
                                        className="flex items-center gap-1.5 px-3 py-1 bg-rose-600 text-white text-[10px] font-black rounded-lg hover:bg-rose-700 transition-colors">
                                        <AlertTriangle size={11}/> {logic.stats.ausentes} AUSENTES — Gestionar
                                    </button>
                                )}
                                {logic.stats.vacantes > 0 && (
                                    <button onClick={() => logic.setViewTab('VACANTES' as any)}
                                        className="flex items-center gap-1.5 px-3 py-1 bg-rose-100 text-rose-700 border border-rose-300 text-[10px] font-black rounded-lg hover:bg-rose-200 transition-colors">
                                        <UserX size={11}/> {logic.stats.vacantes} VACANTES — Ver
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* ── GRID COBERTURA POR OBJETIVO (colapsable) ── */}
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

            <div className={`${mapCollapsed || isExternalMap ? 'h-[calc(100vh-164px)] lg:h-[calc(100vh-100px)]' : 'h-[calc(100vh-164px)] lg:h-[calc(100vh-100px)]'} flex flex-col lg:flex-row gap-4 p-2 animate-in fade-in relative`}>
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
                            <button onClick={handleUndockMap} className="bg-white p-2 rounded-lg shadow hover:bg-slate-100"><MonitorUp size={18} className="text-indigo-600"/></button>
                        </div>
                    </div>
                )}
                {!isExternalMap && mapCollapsed && (
                    <button onClick={() => setMapCollapsed(false)}
                        className="hidden lg:flex items-center gap-2 w-10 bg-slate-100 rounded-xl border border-slate-200 shadow-inner hover:bg-slate-200 transition-colors writing-mode-vertical justify-center"
                        title="Expandir mapa">
                        <MapPin size={16} className="text-slate-400"/>
                        <span className="text-[9px] font-black text-slate-400 uppercase" style={{writingMode:'vertical-rl', transform:'rotate(180deg)'}}>Ver mapa</span>
                    </button>
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
                                {isExternalMap && <button onClick={() => setIsExternalMap(false)} className="px-2 py-1 bg-indigo-50 text-indigo-700 font-bold text-[9px] rounded-lg border">Restaurar</button>}
                                <button onClick={() => logic.setIsCompact(!logic.isCompact)} aria-label={logic.isCompact ? 'Expandir panel' : 'Compactar panel'} className="p-1 bg-slate-100 rounded-lg text-slate-600">{logic.isCompact ? <Maximize2 size={12} aria-hidden="true"/> : <Minimize2 size={12} aria-hidden="true"/>}</button>
                            </div>
                        </div>

                        {/* Barra de sesión compacta */}
                        {session.isAutoMode ? (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-1.5 space-y-1">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"/>
                                        <span className="text-[10px] font-black text-amber-700 uppercase">Modo Automático</span>
                                    </div>
                                    <button onClick={session.startSession} className="px-2 py-1 bg-indigo-600 text-white text-[9px] font-black rounded-lg hover:bg-indigo-700">INICIAR GUARDIA</button>
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
                                            <span className="text-[8px] text-rose-600 font-black">¿Confirmar?</span>
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

                        {/* KPIs compactos */}
                        <div className="grid grid-cols-6 gap-0.5 mb-1.5">
                            {[
                                { label: 'PRES.', title: 'Presentes', value: logic.stats.activos,   text: 'text-emerald-700', bg: 'bg-emerald-50' },
                                { label: 'PLAN',  title: 'Planificados', value: logic.stats.plan,       text: 'text-indigo-700',  bg: 'bg-indigo-50'  },
                                { label: 'RET.',  title: 'Retenidos', value: logic.stats.retenidos,  text: 'text-amber-700',   bg: 'bg-amber-50'   },
                                { label: 'VAC.',  title: 'Vacantes', value: logic.stats.vacantes,   text: 'text-rose-700',    bg: 'bg-rose-50'    },
                                { label: 'AUS.',  title: 'Ausentes', value: logic.stats.ausentes,   text: 'text-rose-900',    bg: 'bg-rose-50'    },
                                { label: 'TOTAL', title: 'Total de turnos', value: logic.stats.plan + logic.stats.activos + logic.stats.retenidos + logic.stats.vacantes + logic.stats.ausentes, text: 'text-slate-800', bg: 'bg-slate-100' },
                            ].map(m => (
                                <div key={m.label} title={m.title} className={`${m.bg} rounded px-1 py-1 text-center cursor-default`}>
                                    <div className={`text-sm font-black leading-none ${m.text}`}>{m.value}</div>
                                    <div className="text-[7px] font-black uppercase text-slate-400 mt-0.5 leading-none">{m.label}</div>
                                </div>
                            ))}
                        </div>

                        {/* Cliente + Búsqueda en misma fila */}
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

                        {/* Tabs compactos */}
                        <div className="flex p-0.5 bg-slate-100 rounded-lg gap-0.5 overflow-x-auto">
                            {tabs.map(t => {
                                const isUrgent = (t.id === 'VACANTES' || t.id === 'AUSENTES') && t.count > 0;
                                const isActive = logic.viewTab === t.id;
                                return (
                                    <button key={t.id} onClick={() => logic.setViewTab(t.id as any)}
                                        className={`relative flex-1 py-1 text-[9px] font-black uppercase rounded-md transition-all whitespace-nowrap
                                            ${isActive
                                                ? (isUrgent ? 'bg-rose-600 text-white shadow' : 'bg-white shadow ' + t.color)
                                                : (isUrgent ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' : 'text-slate-400 hover:bg-slate-200')
                                            }`}>
                                        {isUrgent && !isActive && (
                                            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-rose-500 rounded-full animate-ping"/>
                                        )}
                                        {t.label}<br/>
                                        <span className={`text-[9px] ${isUrgent && isActive ? 'text-rose-100' : ''}`}>({t.count || 0})</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── Panel ausencias autorizadas hoy ── */}
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

                        {/* ══ MODO OBJETIVOS (default) ════════════════════════════════ */}
                        {viewMode === 'objetivos' && (
                        <div className="p-2 space-y-1.5">
                            {objectivesWithAlerts.length === 0 ? (
                                <div className="text-center py-10 text-slate-400 text-xs">Sin datos de objetivos</div>
                            ) : objectivesWithAlerts.map(obj => {
                                const pct = (obj.active + obj.retention) > 0 && obj.total > 0
                                    ? Math.round(((obj.active + obj.retention) / Math.max(obj.total - obj.plan, 1)) * 100)
                                    : obj.total > 0 ? 0 : 100;
                                const isCrit = obj.absent > 0 || obj.vacant > 0;
                                const isWarn = obj.retention > 0;
                                const isExpanded = expandedObjectiveId === obj.objectiveId;
                                const borderColor = isCrit ? 'border-rose-300' : isWarn ? 'border-orange-300' : 'border-slate-200';
                                const bgColor = isCrit ? 'bg-rose-50' : isWarn ? 'bg-orange-50/40' : 'bg-white';

                                // OBJ expandido: muestra TODOS los guardias relevantes del objetivo
                                // (no filtra por tab — muestra el cuadro completo del objetivo)
                                const now2 = new Date();
                                const objShifts = logic.processedData.filter((s: any) => {
                                    if (s.objectiveId !== obj.objectiveId) return false;
                                    if (s.isFranco) return false;
                                    return isSameDay(s.shiftDateObj, now2) || ((s.isPresent || s.isRetention) && !s.isCompleted);
                                }).sort((a: any, b: any) => {
                                    // Orden: ausentes primero, luego activos, luego plan
                                    const statusOrder = (s: any) =>
                                        s.isAbsent || s.isPotentialAbsence ? 0
                                        : s.isPresent ? 1
                                        : s.isRetention ? 2
                                        : s.isOperationalVacancy ? 3
                                        : 4; // plan/future
                                    return statusOrder(a) - statusOrder(b);
                                });

                                return (
                                    <div key={obj.objectiveId} className={`rounded-xl border ${borderColor} ${bgColor} overflow-hidden transition-all`}>
                                        {/* Header del objetivo */}
                                        <div className="px-3 py-2.5 flex items-center gap-2">
                                            {/* Indicador color */}
                                            <div className={`w-2 h-2 rounded-full shrink-0 ${isCrit ? 'bg-rose-500 animate-pulse' : isWarn ? 'bg-orange-500' : 'bg-emerald-500'}`}/>

                                            {/* Info principal */}
                                            <div className="flex-1 min-w-0" onClick={() => setExpandedObjectiveId(isExpanded ? null : obj.objectiveId)} style={{cursor:'pointer'}}>
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
                                                        className="p-1.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors"
                                                        title="Protocolo cobertura">
                                                        <Siren size={12}/>
                                                    </button>
                                                )}
                                                <button onClick={() => setExpandedObjectiveId(isExpanded ? null : obj.objectiveId)}
                                                    className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors">
                                                    {isExpanded ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
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
                                                        onRevertAbsence={handleRevertAbsence}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        )}

                        {/* ══ MODO LISTA (existente) ══════════════════════════════════ */}
                        {viewMode === 'lista' && (
                        <div className="p-3 space-y-2">
                        {logic.listData.length === 0 ? <div className="text-center py-10 text-slate-400 text-xs">Sin novedades en esta categoría</div> :
                            isGrouped ? (groupedList.map((group: any) => { const today = new Date(); const pubKey = `${group.id}_${today.getFullYear()}_${today.getMonth()+1}`; const isPublished = !!logic.publishStatusMap[pubKey]; return <ObjectiveGroup key={group.id} group={group} modals={modalSetters} isCompact={logic.isCompact} isAutoMode={session.isAutoMode} onReport={handleReportPlanning} viewTab={logic.viewTab} onOpenWorkedFranco={(s:any)=>setWorkedFrancoData({isOpen:true, shift:s})} onNovedadAbsence={handleNovedadAbsence} onOpenWA={handleOpenWA} isPublished={isPublished}/>; })) :
                            (logic.listData.map((s:any) => <GuardCard key={s.id} shift={s} viewTab={logic.viewTab} isCompact={logic.isCompact} isAutoMode={session.isAutoMode} onOpenCheckout={(s:any)=>setCheckoutData({isOpen:true, shift:s})} onOpenAttendance={(s:any)=>setAttendanceData({isOpen:true, shift:s})} onOpenHandover={(s:any)=>setHandoverData({isOpen:true, shift:s})} onOpenInterrupt={(s:any)=>setInterruptData({isOpen:true, shift:s})} onOpenCoverage={(s:any)=> { setCoverageData({isOpen:true, shift:s}); }} onReportPlanning={handleReportPlanning} onOpenWorkedFranco={(s:any)=>setWorkedFrancoData({isOpen:true, shift:s})} onNovedadAbsence={handleNovedadAbsence} onOpenWA={handleOpenWA} onRevertAbsence={handleRevertAbsence}/>))
                        }
                        </div>
                        )}

                    </div>

                    {/* ── BITÁCORA collapsible ─────────────────────────── */}
                    <div className={`border-t border-slate-200 bg-white flex flex-col shrink-0 transition-all duration-200 ${bitacoraOpen ? 'h-80' : ''}`}>
                      {/* Header — always visible, click to toggle */}
                      <div className="px-3 py-1.5 flex items-center gap-1 bg-slate-50 cursor-pointer select-none"
                           onClick={() => setBitacoraOpen(v => !v)}>
                        <ClipboardList size={12} className="text-slate-400 shrink-0"/>
                        <span className="text-[9px] font-black text-slate-500 uppercase flex-1">Bitácora</span>
                        {!bitacoraOpen && filteredBitacora.length > 0 && (
                          <span className="text-[9px] text-slate-400 mr-1">{filteredBitacora.length} eventos</span>
                        )}
                        {!bitacoraOpen && pendingNovedades.length > 0 && (
                          <span className="text-[9px] font-black bg-rose-500 text-white px-1.5 rounded-full animate-pulse mr-1">{pendingNovedades.length}</span>
                        )}
                        {bitacoraOpen ? <ChevronDown size={12} className="text-slate-400"/> : <ChevronRight size={12} className="text-slate-400"/>}
                      </div>
                      {/* Content — only when open */}
                      {bitacoraOpen && (<>
                        <div className="px-2 py-1 border-b border-slate-100 flex items-center gap-1 bg-slate-50" onClick={e => e.stopPropagation()}>
                          {([
                            { id:'reciente' as const,    label:'Actividad',   count: logic.recentLogs.filter((l:any)=>l.formattedActor!=='VACANTE').length, urgent: false },
                            { id:'operaciones' as const, label:'Operaciones', count: logic.recentLogs.filter((l:any)=>{ const a=(l.action||'').toUpperCase(); return a.includes('CHECK')||a.includes('ABSENT')||a.includes('HANDOVER')||a.includes('COVERAGE')||a.includes('FRANCO')||a.includes('INTERRUPT')||a.includes('GUARD')||a.includes('TURNO'); }).length, urgent: false },
                            { id:'alertas' as const,     label:'Novedades',   count: pendingNovedades.length, urgent: pendingNovedades.length > 0 },
                          ]).map(t => (
                            <button key={t.id} onClick={() => setBitacoraTab(t.id)}
                              className={`relative flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase transition-colors
                                ${bitacoraTab===t.id
                                  ? (t.urgent ? 'bg-rose-600 text-white' : 'bg-slate-800 text-white')
                                  : (t.urgent ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'text-slate-400 hover:bg-slate-100')}`}>
                              {t.id === 'alertas' && <Siren size={10}/>}
                              {t.label}
                              <span className={`text-[9px] font-black px-1 rounded-full
                                ${bitacoraTab===t.id ? 'bg-white/20' : t.urgent ? 'bg-rose-500 text-white animate-pulse' : 'bg-slate-200 text-slate-500'}`}>
                                {t.count}
                              </span>
                            </button>
                          ))}
                          <button onClick={generateDailyReport} className="ml-auto p-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg" title="Exportar PDF">
                            <Printer size={11}/>
                          </button>
                        </div>
                        {/* ── Tab Actividad / Operaciones ── */}
                        {bitacoraTab !== 'alertas' && (
                        <div className="flex-1 overflow-y-auto">
                          <table className="w-full text-[10px] text-left">
                            <thead className="bg-slate-50 text-slate-400 uppercase font-bold sticky top-0">
                              <tr>
                                <th className="px-3 py-1 w-14">Hora</th>
                                <th className="px-2 py-1 w-28">Evento</th>
                                <th className="px-2 py-1 w-24">Actor</th>
                                <th className="px-2 py-1">Detalle</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {filteredBitacora.length === 0 ? (
                                <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-300 text-[10px]">Sin registros en esta sección</td></tr>
                              ) : filteredBitacora.map((log: any) => {
                                const action = (log.action || '').toUpperCase();
                                const isOp = action.includes('CHECK') || action.includes('ABSENT') || action.includes('HANDOVER') || action.includes('FRANCO');
                                const isAlert = action.includes('ABSENT') || action.includes('VACANTE') || action.includes('INTERRUPT');
                                const dotColor = isAlert ? 'bg-rose-400' : isOp ? 'bg-emerald-400' : 'bg-indigo-400';
                                return (
                                  <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                                    <td className="px-3 py-1.5 font-mono text-slate-400 text-[9px]">{formatTimeSimple(log.time)}</td>
                                    <td className="px-2 py-1.5">
                                      <div className="flex items-center gap-1.5">
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`}/>
                                        <span className="font-bold text-slate-700 uppercase text-[9px] truncate">{(log.action||'').replace('MANUAL_','')}</span>
                                      </div>
                                    </td>
                                    <td className="px-2 py-1.5 text-slate-500 truncate max-w-[80px] text-[9px]">{log.formattedActor}</td>
                                    <td className="px-2 py-1.5 text-slate-400 truncate max-w-[160px] text-[9px]">{log.fullDetail}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        )}

                        {/* ── Tab Novedades (inline, siempre accesible) ── */}
                        {bitacoraTab === 'alertas' && (
                        <div className="flex-1 overflow-y-auto">
                          {pendingNovedades.length === 0 ? (
                            <div className="p-6 text-center">
                              <CheckCircle size={24} className="mx-auto mb-2 text-emerald-400 opacity-50"/>
                              <p className="text-xs font-bold text-slate-400">Sin novedades pendientes</p>
                            </div>
                          ) : pendingNovedades.map((n: any) => {
                            const ts = n.createdAt?.seconds ? new Date(n.createdAt.seconds * 1000) : null;
                            const isProto = n.type === 'VACANTE_PROTOCOLO_COBERTURA';
                            const isRetencion = n.type === 'RETENCION_LARGA';
                            const isRelevo = n.type === 'POSICION_SIN_RELEVO';
                            const isAbsence = n.type === 'AUSENCIA_AUTO' || n.type === 'AUSENCIA_OPERATIVA';
                            const isAnticipada = n.type === 'AVISO_AUSENCIA_ANTICIPADA';
                            const isConvocado = n.type === 'CONVOCATORIA_RETEN' || n.type === 'FRANCO_TRABAJADO';
                            const isCortoplazo = n.type === 'AUSENCIA_CORTO_PLAZO';
                            const typeLabel = isCortoplazo ? 'URGENTE' : isAnticipada ? 'ANTIC' : isConvocado ? 'CONV' : isProto ? 'PROT' : isAbsence ? 'AUS' : isRelevo ? 'REL' : isRetencion ? 'REC' : 'NOV';
                            const typeBg = isCortoplazo ? 'bg-red-600 text-white animate-pulse' : isAnticipada ? 'bg-amber-100 text-amber-800' : isConvocado ? 'bg-indigo-100 text-indigo-700' : isProto ? 'bg-orange-100 text-orange-700' : isAbsence ? 'bg-rose-100 text-rose-700' : isRelevo ? 'bg-amber-100 text-amber-700' : isRetencion ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-600';
                            const leftBorder = isCortoplazo ? 'border-l-red-600' : isAnticipada ? 'border-l-amber-400' : isConvocado ? 'border-l-indigo-500' : isAbsence ? 'border-l-rose-500' : isRelevo ? 'border-l-amber-500' : isProto ? 'border-l-orange-500' : isRetencion ? 'border-l-orange-600' : 'border-l-slate-300';
                            return (
                              <div key={n.id} className={`px-3 py-2 flex items-center gap-2 border-l-4 ${leftBorder} border-b border-slate-50 hover:bg-slate-50/60 transition-colors`}>
                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded w-12 text-center shrink-0 ${typeBg}`}>{typeLabel}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] font-bold text-slate-800 truncate leading-tight">
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
                                <button onClick={() => handleAtenderNovedad(n)}
                                  className="p-1.5 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors shrink-0" title="Atender">
                                  <CheckCircle size={11}/>
                                </button>
                              </div>
                            );
                          })}
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

                {/* ── PANEL FLOTANTE DE ALERTAS — solo visible cuando el mapa NO está en ventana externa ── */}
                {!isExternalMap && <div className="absolute bottom-8 left-8 z-[1000]">
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
                    <div className="w-[480px] flex flex-col bg-white rounded-xl shadow-2xl border border-slate-200 animate-in slide-in-from-bottom-4 max-h-[70vh]">
                        <div className="px-3 py-2.5 bg-slate-900 rounded-t-2xl flex items-center gap-2">
                            <Siren size={14} className="text-rose-400 shrink-0"/>
                            <span className="font-black uppercase text-xs text-white flex-1">Alertas y Prioridad</span>
                            {totalAlerts > 0 && <span className="bg-rose-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full">{totalAlerts}</span>}
                            <button onClick={() => setNotifPanelOpen(false)} className="p-1 hover:bg-white/10 rounded-lg transition-colors"><X size={14} className="text-slate-400"/></button>
                        </div>

                        {/* ── Sección PRIORIDAD — usa priorityShiftsPanel ya calculado (mismo filtro que stats) ── */}
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
                                        <div key={s.id} className="px-3 py-1.5 flex items-center gap-2 border-l-4 border-l-rose-500 border-b border-slate-50 bg-white hover:bg-rose-50/30 transition-colors">
                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 ${s.isRetention ? 'bg-orange-100 text-orange-700' : 'bg-rose-100 text-rose-700'}`}>
                                                {(s.employeeName || '?')[0]}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[10px] font-bold text-slate-800 truncate leading-tight">
                                                    {s.employeeName || 'Desconocido'}
                                                    <span className={`ml-1.5 text-[9px] font-black px-1 rounded ${s.isRetention ? 'bg-orange-100 text-orange-700' : s.isEarlyStart ? 'bg-indigo-100 text-indigo-700' : s.isAwaitingCoverageCheckIn ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-100 text-rose-700'}`}>
                                                        {s.isRetention ? 'RECARGO' : s.isEarlyStart ? 'ADELANTADO' : s.isAwaitingCoverageCheckIn ? 'CONVOCADO' : 'INMINENTE'}
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
                                    ))}
                                </div>
                            );
                        })()}

                        {/* ── Columnas header novedades ── */}
                        <div className="px-3 py-1 bg-slate-50 border-b border-slate-100 flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase">
                            <span className="w-14 shrink-0">Tipo</span>
                            <span className="flex-1">Objetivo / Posición</span>
                            <span className="w-10 text-right">Hora</span>
                            <span className="w-16 text-center">Acción</span>
                        </div>
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
                            ) : pendingNovedades.map((n: any) => {
                                const ts = n.createdAt?.seconds ? new Date(n.createdAt.seconds * 1000) : null;
                                const isAbsence = n.type === 'AUSENCIA_AUTO';
                                const isRelevo = n.type === 'RELEVO_NO_PRESENTADO' || n.type === 'POSICION_SIN_RELEVO';
                                const isProto = n.type === 'VACANTE_PROTOCOLO_COBERTURA';
                                const isRetencion = n.type === 'RETENCION_LARGA';
                                const isCortoplazo = n.type === 'AUSENCIA_CORTO_PLAZO';
                                const isAnticipada = n.type === 'AVISO_AUSENCIA_ANTICIPADA';

                                const isAdelanto = n.type === 'ADELANTO_TURNO';
                                const isConvocado = n.type === 'CONVOCATORIA_RETEN' || n.type === 'FRANCO_TRABAJADO' || n.type === 'RETENCION';

                                const leftBorder = isCortoplazo ? 'border-l-red-600' : isAnticipada ? 'border-l-amber-400' : isAdelanto || isConvocado ? 'border-l-indigo-500' : isAbsence ? 'border-l-rose-500' : isRelevo ? 'border-l-amber-500' : isProto ? 'border-l-orange-500' : isRetencion ? 'border-l-orange-600' : 'border-l-slate-300';
                                const typeLabel = isCortoplazo ? 'URGENTE' : isAnticipada ? 'ANTIC.' : isAdelanto ? 'ADEL.' : isConvocado ? 'CONV.' : isProto ? 'PROT' : isAbsence ? 'AUS' : isRelevo ? 'REL' : isRetencion ? 'REC' : 'NOV';
                                const typeBg = isCortoplazo ? 'bg-red-600 text-white animate-pulse' : isAnticipada ? 'bg-amber-100 text-amber-800' : isAdelanto || isConvocado ? 'bg-indigo-100 text-indigo-700' : isProto ? 'bg-orange-100 text-orange-700' : isAbsence ? 'bg-rose-100 text-rose-700' : isRelevo ? 'bg-amber-100 text-amber-700' : isRetencion ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-600';
                                const actionBg = isCortoplazo ? 'bg-red-600 hover:bg-red-700' : isAnticipada ? 'bg-amber-600 hover:bg-amber-700' : isAdelanto || isConvocado ? 'bg-indigo-600 hover:bg-indigo-700' : isProto ? 'bg-orange-600 hover:bg-orange-700' : isAbsence ? 'bg-rose-600 hover:bg-rose-700' : isRelevo ? 'bg-amber-600 hover:bg-amber-700' : isRetencion ? 'bg-orange-700 hover:bg-orange-800' : 'bg-slate-700 hover:bg-slate-800';
                                const ActionIcon = isCortoplazo ? Siren : isAnticipada ? BellRing : isAdelanto || isConvocado ? PlayCircle : isProto ? Users : isAbsence ? UserX : isRelevo ? Clock : isRetencion ? Clock : CheckCircle;
                                const actionTitle = isCortoplazo ? 'Protocolo urgente' : isAnticipada ? 'Gestionar ausencia' : isAdelanto || isConvocado ? 'Dar presente' : isProto ? 'Cubrir vacante' : isAbsence ? 'Gestionar ausencia' : isRelevo ? 'Gestionar relevo' : isRetencion ? 'Gestionar retención' : 'Atender';
                                const minutesLabel = (isCortoplazo || isAnticipada) && n.minutesBeforeShift != null && n.minutesBeforeShift > 0
                                    ? ` · ${n.minutesBeforeShift}min`
                                    : '';

                                return (
                                    <div key={n.id} className={`px-3 py-1.5 flex items-center gap-2 border-l-4 ${leftBorder} border-b border-slate-50 hover:bg-slate-50/60 transition-colors`}>
                                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded w-14 text-center shrink-0 ${typeBg}`}>{typeLabel}</span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[10px] font-bold text-slate-800 truncate leading-tight">
                                                {n.employeeName && n.objectiveName
                                                    ? <>{n.employeeName} <span className="text-slate-400 font-normal">·</span> {n.objectiveName}</>
                                                    : n.objectiveName || n.employeeName
                                                    || (n.description ? n.description.replace(/\s*\(detectado[^)]*\)/,'').replace(/\s*\(\d+\s*min\)/,'').trim() : null)
                                                    || (isAbsence ? 'Ausencia automática' : 'Sin info')}
                                                {n.positionName && <span className="text-slate-400 font-normal"> · {n.positionName}</span>}
                                            </p>
                                            <p className="text-[9px] text-slate-400 truncate leading-tight">
                                                {(isCortoplazo || isAnticipada) && n.minutesBeforeShift != null && n.minutesBeforeShift > 0
                                                    ? <span className={`font-black mr-1 ${isCortoplazo ? 'text-red-600' : 'text-amber-600'}`}>⏱ {n.minutesBeforeShift}min al turno</span>
                                                    : null}
                                                {n.description || '-'}
                                            </p>
                                        </div>
                                        <span className="text-[9px] text-slate-400 font-mono w-10 text-right shrink-0">
                                            {ts ? ts.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Argentina/Cordoba'}) : '--'}
                                        </span>
                                        <div className="flex gap-1 shrink-0 w-16 justify-end">
                                            {n.employeePhone && (
                                                <button onClick={() => openWhatsApp(n.employeePhone, waMensaje.bienvenida(n.employeeName||''))}
                                                    className="p-1.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors" title="WhatsApp">
                                                    <MessageCircle size={11}/>
                                                </button>
                                            )}
                                            <button onClick={() => handleAtenderNovedad(n)}
                                                className={`p-1.5 text-white rounded-lg transition-colors ${actionBg}`} title={actionTitle}>
                                                <ActionIcon size={11}/>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                            {recentAtendidas.length > 0 && (
                                <div className="border-t border-slate-100 bg-slate-50/80">
                                    <p className="px-3 py-1 text-[9px] font-black uppercase text-slate-400">Atendidas recientes</p>
                                    {recentAtendidas.map((n: any) => {
                                        const ts = n.atendidaAt?.seconds
                                            ? new Date(n.atendidaAt.seconds * 1000)
                                            : n.createdAt?.seconds
                                                ? new Date(n.createdAt.seconds * 1000)
                                                : null;
                                        return (
                                            <div key={n.id} className="px-3 py-1 flex items-center gap-2 border-b border-slate-100 text-[9px]">
                                                <CheckCircle size={10} className="text-emerald-500 shrink-0"/>
                                                <span className="flex-1 truncate text-slate-600">{n.objectiveName || n.employeeName || n.type}</span>
                                                <span className="text-emerald-700 font-bold shrink-0">{n.atendidaPor || '—'}</span>
                                                <span className="text-slate-400 font-mono shrink-0 w-10 text-right">
                                                    {ts ? ts.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' }) : '--'}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="px-3 py-1.5 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-between items-center">
                            <p className="text-[9px] text-slate-400">{empNovedades.filter((n:any)=>n.status==='ATENDIDA').length} atendidas</p>
                            <p className="text-[9px] text-slate-400">{pendingNovedades.length} pendientes</p>
                        </div>
                    </div>
                );
                })()}
                </div>}
            </div>

            <RetentionModal isOpen={false} onClose={()=>{}} retainedShift={null} />
            <WorkedDayOffModal isOpen={workedFrancoData.isOpen} onClose={()=>setWorkedFrancoData({isOpen:false, shift:null})} shift={workedFrancoData.shift} />
            <CheckOutModal isOpen={checkoutData.isOpen} onClose={() => setCheckoutData({isOpen:false, shift:null})} onConfirm={(nov:string|null) => { if (checkoutData.shift?.id) logic.handleAction('CHECKOUT', checkoutData.shift.id, nov); }} employeeName={checkoutData.shift?.employeeName} />
            <AttendanceModal isOpen={attendanceData.isOpen} onClose={()=>setAttendanceData({isOpen:false, shift:null})} shift={attendanceData.shift} onMarkAbsent={handleMarkAbsent} />
            
            <HandoverModal isOpen={handoverData.isOpen} onClose={()=>setHandoverData({isOpen:false, shift:null})} incomingShift={handoverData.shift} logic={logic} />
            <InterruptModal isOpen={interruptData.isOpen} onClose={()=>setInterruptData({isOpen:false, shift:null})} shift={interruptData.shift} logic={logic} onVacancyCreated={handleVacancyCreated} />
            <CoverageModal isOpen={coverageData.isOpen} onClose={()=>setCoverageData({isOpen:false, shift:null})} absenceShift={coverageData.shift} logic={logic} />
            <WAComposeModal isOpen={waData.isOpen} onClose={() => setWaData(d => ({...d, isOpen: false}))} ctx={waData.ctx} />

        </DashboardLayout>
    );
}