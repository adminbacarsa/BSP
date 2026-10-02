import React, { useState, useEffect } from 'react';
import {
    X, Calendar, Users, MapPin, Search, Send,
    CheckCircle,
    UserCheck, UserX, ClipboardCheck, UserMinus,
} from 'lucide-react';
import { collection, addDoc, deleteDoc, getDocs, getDoc, query, where, serverTimestamp, onSnapshot, updateDoc, doc, Timestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { empresaCollectionQuery } from '@/lib/multiempresa';
import { assignGuardToEvent } from '@/services/eventoAssignService';
import { type Evento, type ServicioEvento } from '@/services/eventoService';
import { solicitudEventoService, type SolicitudEvento } from '@/services/solicitudEventoService';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { aptitudTypeService } from '@/services/aptitudTypeService';
import { type AptitudType, type EmpleadoAptitud } from '@/lib/rrhh/aptitudTypes';
import EventualesCandidatosPanel from '@/components/eventuales/EventualesCandidatosPanel';
import { canConvocarEventuales, convocarEventualEvento } from '@/services/eventualesPlanificacionService';
import {
    AccionChip,
    ConvocatoriaResumen,
    CupoGruposBarra,
    ErrorCallableBox,
    EstadoSolicitudChip,
    EventualEstadoLinea,
    GrupoCandidatosHeader,
    SinEspecificarAviso,
    SituacionAccionBadges,
    type GrupoCupoUi,
} from '@/components/servicios/EventoConvocarResumen';
import {
    agruparCandidatos,
    esPorGenero,
    estadoCupo,
    grupoDeGenero,
    normalizarGenero,
    textoCupoServicio,
    textoResumenCupo,
} from '@/lib/eventuales/cupoGenero.mjs';
import {
    armarPlanConvocatoria,
    CON_TURNO_CODES,
    DISPONIBLE_CODES,
    FRANCO_CODES,
    horarioCorto,
    mensajeErrorCallable,
    resumenEnvio,
    situacionDelDia,
    textoAvisoGuardia,
    type PlanConvocatoria,
} from '@/lib/eventos/convocatoriaPlan';

// ── Helpers ────────────────────────────────────────────────────────────────

function horarioBadge(s: ServicioEvento): string {
    if (s.tipoTurno === '3x8') return '3×8h';
    if (s.tipoTurno === '2x12') return '2×12h';
    return `${s.horaInicio}–${s.horaFin}`;
}

function fmtFecha(ymd: string): string {
    if (!ymd) return '—';
    const [y, m, d] = ymd.split('-');
    return `${d}/${m}/${y.slice(2)}`;
}

function calcHorasServicio(horaInicio: string, horaFin: string): number {
    const [sh, sm] = String(horaInicio || '08:00').split(':').map(Number);
    const [eh, em] = String(horaFin || '16:00').split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    return Math.max(1, Math.round(mins / 60));
}

/** `HH:MM` local de un startTime/endTime (Timestamp o ISO string). */
function horaDeTurno(value: unknown): string {
    if (!value) return '';
    if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
        const d = (value as { toDate: () => Date }).toDate();
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    const s = String(value);
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(11, 16) : '';
}

// ── Types ──────────────────────────────────────────────────────────────────

interface EmpRow {
    id: string;
    uid?: string;
    name: string;
    fileNumber?: string;
    aptitudes?: EmpleadoAptitud[];
    preferredObjectiveId?: string;
    preferredObjectiveName?: string;
    objectiveId?: string;
    objectiveName?: string;
    /** 'M' | 'F' | '' (sin especificar). Cupo por género. */
    genero: string;
}

interface Props {
    evento: Evento;
    empresaId: string;
    onClose: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function EventoDetailModal({ evento, empresaId, onClose }: Props) {
    const { addToast } = useToast();
    const { isSuperAdmin, rolePermissions } = useAuth();
    const canConvocarEventual = canConvocarEventuales(isSuperAdmin, rolePermissions);
    /** Origen del convocado: EVENTUALES (bolsa) primero, después la nómina de la empresa. */
    const [fuente, setFuente] = useState<'eventuales' | 'nomina'>('eventuales');
    const [eventualBusy, setEventualBusy] = useState(false);
    const [selectedSrvId, setSelectedSrvId] = useState<string>(evento.servicios?.[0]?.id || '');
    const [empleados, setEmpleados] = useState<EmpRow[]>([]);
    const [availMap, setAvailMap] = useState<Record<string, string>>({});   // empleadoId → código turno | 'libre'
    const [horarioMap, setHorarioMap] = useState<Record<string, string>>({}); // empleadoId → «07–15» del turno de ese día
    const [solicitudes, setSolicitudes] = useState<SolicitudEvento[]>([]);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [sending, setSending] = useState(false);
    /** Paso de resumen (dos grupos) antes de enviar. */
    const [revisando, setRevisando] = useState(false);
    const [eventualError, setEventualError] = useState<string | null>(null);
    const [ultimoEventual, setUltimoEventual] = useState<{ cuil: string; nombre: string } | null>(null);
    const [loadingAvail, setLoadingAvail] = useState(false);
    const [tab, setTab] = useState<'convocar' | 'estado' | 'cronograma'>('convocar');
    const [aptitudCatalog, setAptitudCatalog] = useState<AptitudType[]>([]);
    const [soloRequisitos, setSoloRequisitos] = useState(false);
    const [filterAvail, setFilterAvail] = useState<'todos' | 'libre' | 'RET' | 'franco' | 'conTurno'>('todos');
    const [evTurnos, setEvTurnos] = useState<any[]>([]);
    const [loadingCrono, setLoadingCrono] = useState(false);
    const [selectedCronoTurnos, setSelectedCronoTurnos] = useState<Set<string>>(new Set());

    const selectedSrv = evento.servicios?.find(s => s.id === selectedSrvId) || null;

    useEffect(() => {
        setSelectedCronoTurnos(new Set());
        setRevisando(false);
    }, [selectedSrvId, tab, evento.id]);

    // Cargar empleados activos una vez
    useEffect(() => {
        const q = empresaCollectionQuery('empleados', empresaId, true);
        getDocs(q as ReturnType<typeof query>).then(snap => {
            const rows: EmpRow[] = snap.docs
                .filter(d => {
                    const st = String((d.data() as any).status || 'ACTIVE').toUpperCase();
                    return st === 'ACTIVE' || st === 'ACTIVO';
                })
                .map(d => {
                    const dat = d.data() as any;
                    const name = dat.name
                        || `${dat.firstName || dat.nombre || ''} ${dat.lastName || dat.apellido || ''}`.trim()
                        || d.id;
                    return {
                        id: d.id,
                        uid: dat.uid || '',
                        name,
                        fileNumber: dat.fileNumber || dat.legajo || '',
                        aptitudes: dat.aptitudes || [],
                        preferredObjectiveId: dat.preferredObjectiveId || '',
                        preferredObjectiveName: dat.preferredObjectiveName || '',
                        objectiveId: dat.objectiveId || '',
                        objectiveName: dat.objectiveName || '',
                        genero: normalizarGenero(dat.genero) as string,
                    };
                })
                .sort((a, b) => a.name.localeCompare(b.name, 'es'));
            // Deduplicar por legajo (puede haber docs duplicados en Firestore)
            const seen = new Set<string>();
            const unique = rows.filter(r => {
                const key = r.fileNumber || r.id;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            setEmpleados(unique);
        }).catch(console.error);
    }, [empresaId]);

    useEffect(() => {
        aptitudTypeService.ensureSeeded(empresaId).then(setAptitudCatalog).catch(() => {});
    }, [empresaId]);

    // Suscripción en tiempo real a turnos EV del evento
    useEffect(() => {
        if (!evento.id) return;
        setLoadingCrono(true);
        const q = query(
            collection(db, 'turnos'),
            where('empresaId', '==', empresaId),
            where('eventoId', '==', evento.id),
        );
        const unsub = onSnapshot(q, snap => {
            setEvTurnos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoadingCrono(false);
        }, () => setLoadingCrono(false));
        return unsub;
    }, [evento.id, empresaId]);

    async function unassignTurno(turno: any) {
        try {
            const emp = empleados.find((e) => e.id === turno.employeeId || (e.uid && e.uid === turno.employeeId));
            const srv = (evento.servicios || []).find((s) => s.id === turno.servicioId);
            const fecha = srv?.fecha ? fmtFecha(srv.fecha) : '';
            const horario = srv ? horarioBadge(srv) : '';
            if (turno.replacedCode) {
                // Había un turno previo — revertir al código original
                await updateDoc(doc(db, 'turnos', turno.id), {
                    code: turno.replacedCode,
                    origin: null,
                    eventoId: null,
                    eventoNombre: null,
                    servicioId: null,
                    servicioNombre: null,
                    replacedCode: null,
                });
            } else {
                await deleteDoc(doc(db, 'turnos', turno.id));
            }
            // Revertir/eliminar solicitud si existe
            const sol = solicitudes.find(s => s.empleadoId === turno.employeeId && s.servicioId === turno.servicioId);
            if (sol) {
                if (sol.tipo === 'admin_asigna') {
                    await deleteDoc(doc(db, 'solicitudes_evento', sol.id));
                } else {
                    await updateDoc(doc(db, 'solicitudes_evento', sol.id), { status: 'convocado' });
                }
            }
            await addDoc(collection(db, 'user_notifications'), {
                empresaId,
                uid: emp?.uid || null,
                employeeId: turno.employeeId || null,
                type: 'EVENTO_DESAFECTADO',
                target: 'employee',
                title: `Desafectación de evento: ${evento.nombre}`,
                body: `${srv?.nombre || turno.servicioNombre || 'Servicio'}${fecha ? ` · ${fecha}` : ''}${horario ? ` · ${horario}` : ''}.`,
                eventoId: evento.id || null,
                eventoNombre: evento.nombre || null,
                servicioId: turno.servicioId || null,
                servicioNombre: srv?.nombre || turno.servicioNombre || null,
                read: false,
                readAt: null,
                createdAt: serverTimestamp(),
            });
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    function resolveTurnoGuardName(turno: any): string {
        const rawName = String(turno?.employeeName || '').trim();
        const rawId = String(turno?.employeeId || '').trim();
        const fromEmp = empleados.find((e) => e.id === rawId || (e.uid && e.uid === rawId));
        if (rawName && rawName !== rawId) return rawName;
        if (fromEmp?.name) return fromEmp.name;
        return rawName || rawId || 'Sin nombre';
    }

    async function handleUnassignGuard(turno: any) {
        const nombre = resolveTurnoGuardName(turno);
        if (!window.confirm(`¿Desasignar a ${nombre} de este evento?`)) return;
        const ok = await unassignTurno(turno);
        if (ok) addToast(`${nombre} desasignado del evento`, 'success');
        else addToast('Error al desasignar', 'error');
    }

    async function handleUnassignMany(target: any[], label: string) {
        if (target.length === 0) return;
        if (!window.confirm(`¿Desasignar ${target.length} guardia(s) ${label}?`)) return;
        let ok = 0;
        let err = 0;
        for (const t of target) {
            // eslint-disable-next-line no-await-in-loop
            const done = await unassignTurno(t);
            if (done) ok++;
            else err++;
        }
        setSelectedCronoTurnos(new Set());
        if (ok > 0) addToast(`${ok} guardia(s) desasignado(s)`, 'success');
        if (err > 0) addToast(`${err} guardia(s) no se pudieron desasignar`, 'error');
    }

    async function handleTogglePresence(turnoId: string, field: 'isPresent' | 'isAbsent' | 'isCompleted', value: boolean) {
        try {
            await updateDoc(doc(db, 'turnos', turnoId), { [field]: value });
        } catch (e) {
            console.error(e);
            addToast('Error al actualizar presencia', 'error');
        }
    }

    // Suscripción en tiempo real a solicitudes del evento
    useEffect(() => {
        if (!evento.id) return;
        const q = query(collection(db, 'solicitudes_evento'), where('eventoId', '==', evento.id));
        const unsub = onSnapshot(q, (snap) => {
            setSolicitudes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SolicitudEvento)));
        });
        return unsub;
    }, [evento.id]);

    // Cargar disponibilidad al cambiar servicio
    useEffect(() => {
        if (!selectedSrv?.fecha) return;
        setLoadingAvail(true);
        const fecha = selectedSrv.fecha;
        const [y, mo, d2] = fecha.split('-').map(Number);
        const dayStart = Timestamp.fromDate(new Date(y, mo - 1, d2, 0, 0, 0));
        const dayEnd   = Timestamp.fromDate(new Date(y, mo - 1, d2, 23, 59, 59));

        Promise.all([
            getDocs(query(collection(db, 'turnos'),
                where('empresaId', '==', empresaId),
                where('startTime', '>=', dayStart),
                where('startTime', '<=', dayEnd),
            )),
            getDocs(query(collection(db, 'turnos'),
                where('empresaId', '==', empresaId),
                where('startTime', '>=', `${fecha}T00:00:00`),
                where('startTime', '<=', `${fecha}T23:59:59`),
            )),
        ]).then(async ([snapTs, snapStr]) => {
            const seen = new Set<string>();
            const allDocs = [...snapTs.docs, ...snapStr.docs].filter(d3 => {
                if (seen.has(d3.id)) return false;
                seen.add(d3.id);
                return true;
            });

            // Recolectar eventoIds de turnos EV para verificar cuáles siguen existiendo
            const evEventoIds = new Set<string>();
            allDocs.forEach(d3 => {
                const t = d3.data();
                if (!t.draft && t.employeeId && String(t.code || '').toUpperCase() === 'EV' && t.eventoId && t.eventoId !== evento.id) {
                    evEventoIds.add(t.eventoId);
                }
            });

            // Verificar existencia de cada evento referenciado
            const existingEvIds = new Set<string>([evento.id]);
            await Promise.all([...evEventoIds].map(async eid => {
                try {
                    const snap2 = await getDoc(doc(db, 'eventos', eid));
                    if (snap2.exists()) existingEvIds.add(eid);
                } catch { /* continuar */ }
            }));

            const map: Record<string, string> = {};
            const horarios: Record<string, string> = {};
            allDocs.forEach(d3 => {
                const t = d3.data();
                if (!t.employeeId || t.draft) return;
                const code = String(t.code || '').toUpperCase();
                if (code === 'EV' && t.eventoId && !existingEvIds.has(t.eventoId)) {
                    // Turno EV huérfano (evento eliminado) → usar replacedCode o libre
                    const restored = t.replacedCode ? String(t.replacedCode).toUpperCase() : 'libre';
                    map[t.employeeId] = restored;
                } else {
                    map[t.employeeId] = t.code || 'ocupado';
                    horarios[t.employeeId] = horarioCorto(horaDeTurno(t.startTime), horaDeTurno(t.endTime));
                }
            });
            setAvailMap(map);
            setHorarioMap(horarios);
        }).catch(console.error).finally(() => setLoadingAvail(false));
    }, [selectedSrvId, empresaId, selectedSrv?.fecha, evento.id]);

    /** Plan de la selección actual: quién se asigna directo (libre/RET) y quién tiene que aceptar. */
    function planActual(): PlanConvocatoria {
        const empMap = Object.fromEntries(empleados.map(e => [e.id, e]));
        const pendingIds = Array.from(selected).filter((empId) => !yaEnviadosIds.has(empId) && empMap[empId]);
        // Cupo por grupo: la asignación directa cuenta al momento; convocar no tiene tope (orden de aceptación).
        const cupoDisponible = cupoEstado && cupoEstado.cupo > 0
            ? Object.fromEntries(cupoEstado.grupos.map((g: GrupoCupoUi) => [g.grupo, Math.max(0, g.cupo - g.ocupados)]))
            : (porGenero ? { M: Number.POSITIVE_INFINITY, F: Number.POSITIVE_INFINITY } : Number.POSITIVE_INFINITY);
        return armarPlanConvocatoria(
            pendingIds.map((empId) => ({
                id: empId,
                nombre: empMap[empId].name,
                code: availMap[empId] || 'libre',
                horario: horarioMap[empId] || '',
                grupo: selectedSrv ? (grupoDeGenero(selectedSrv, empMap[empId].genero) as string | null) : 'TODOS',
            })),
            cupoDisponible,
        );
    }

    // Enviar: asignación directa + aviso para libre/RET, convocatoria con aceptar/rechazar para el resto
    async function handleConvocar() {
        if (!selectedSrv || selected.size === 0) return;
        setSending(true);
        const convocadoPor = getAuth().currentUser?.uid || '';
        const empMap = Object.fromEntries(empleados.map(e => [e.id, e]));
        const plan = planActual();
        const toAssignDirect = plan.notificar.map((p) => p.id);
        const toConvocar = plan.convocar.map((p) => p.id);
        const avisoCtx = { evento: evento.nombre, servicio: selectedSrv.nombre, fecha: fmtFecha(selectedSrv.fecha), horario: horarioBadge(selectedSrv) };
        try {
            for (const empId of toAssignDirect) {
                const emp = empMap[empId];
                if (!emp) continue;
                const guardHours = selectedSrv.tipoTurno === '3x8'
                    ? 8
                    : selectedSrv.tipoTurno === '2x12'
                        ? 12
                        : calcHorasServicio(selectedSrv.horaInicio, selectedSrv.horaFin);
                const grupoEmp = grupoDeGenero(selectedSrv, emp.genero) as string | null;
                const solicitudRef = await addDoc(collection(db, 'solicitudes_evento'), {
                    empresaId,
                    eventoId: evento.id,
                    eventoNombre: evento.nombre,
                    servicioId: selectedSrv.id,
                    servicioNombre: selectedSrv.nombre,
                    servicioFecha: selectedSrv.fecha,
                    empleadoId: empId,
                    empleadoNombre: emp.name,
                    status: 'aprobada',
                    tipo: 'admin_asigna',
                    convocadoPor,
                    respondidoPor: convocadoPor,
                    genero: emp.genero || '',
                    cupoGrupo: grupoEmp || 'TODOS',
                    respondidoAt: serverTimestamp(),
                    creadoAt: serverTimestamp(),
                });
                try {
                    // El servidor cuenta el cupo del grupo al momento (transacción) y escribe el turno EV.
                    await assignGuardToEvent({
                        empresaId,
                        empleadoId: empId,
                        empleadoNombre: emp.name,
                        empleadoObjectiveId: emp.preferredObjectiveId || emp.objectiveId || undefined,
                        empleadoObjectiveName: emp.preferredObjectiveName || emp.objectiveName || undefined,
                        eventoId: evento.id!,
                        eventoNombre: evento.nombre,
                        clienteId: evento.clienteId,
                        clienteNombre: evento.clienteNombre,
                        servicioId: selectedSrv.id,
                        servicioNombre: selectedSrv.nombre,
                        servicioFecha: selectedSrv.fecha,
                        horaInicio: selectedSrv.horaInicio,
                        horaFin: selectedSrv.horaFin,
                        horas: guardHours,
                        solicitudId: solicitudRef.id,
                        respondidoPor: convocadoPor,
                    });
                } catch (e) {
                    // Cupo completo u otro rechazo del servidor: la solicitud directa no queda como confirmada.
                    await deleteDoc(solicitudRef).catch(() => {});
                    throw e;
                }
                const avisoAsignado = textoAvisoGuardia('NOTIFICAR', avisoCtx);
                await addDoc(collection(db, 'user_notifications'), {
                    empresaId,
                    uid: emp.uid || null,
                    employeeId: empId,
                    type: 'EVENTO_CONFIRMADO',
                    target: 'employee',
                    title: avisoAsignado.title,
                    body: avisoAsignado.body,
                    eventoId: evento.id,
                    eventoNombre: evento.nombre,
                    servicioId: selectedSrv.id,
                    servicioNombre: selectedSrv.nombre,
                    read: false,
                    readAt: null,
                    createdAt: serverTimestamp(),
                });
            }

            await Promise.all(toConvocar.map(async empId => {
                const emp = empMap[empId];
                if (!emp) return;
                const solicitudId = await solicitudEventoService.convocar({
                    empresaId,
                    eventoId: evento.id!,
                    eventoNombre: evento.nombre,
                    servicioId: selectedSrv.id,
                    servicioNombre: selectedSrv.nombre,
                    servicioFecha: selectedSrv.fecha,
                    empleadoId: empId,
                    empleadoNombre: emp.name,
                    convocadoPor,
                    genero: emp.genero || '',
                    cupoGrupo: (grupoDeGenero(selectedSrv, emp.genero) as string | null) || 'TODOS',
                });
                const avisoConvocado = textoAvisoGuardia('CONVOCAR', avisoCtx);
                await addDoc(collection(db, 'user_notifications'), {
                    empresaId,
                    uid: emp.uid || null,
                    employeeId: empId,
                    type: 'CONVOCATORIA_EVENTO',
                    target: 'employee',
                    title: avisoConvocado.title,
                    body: avisoConvocado.body,
                    eventoId: evento.id,
                    eventoNombre: evento.nombre,
                    servicioId: selectedSrv.id,
                    solicitudId,
                    read: false,
                    readAt: null,
                    createdAt: serverTimestamp(),
                });
            }));
            addToast(resumenEnvio(plan), 'success');
            setSelected(new Set());
            setRevisando(false);
            setTab('estado');
        } catch (e) {
            console.error(e);
            addToast(mensajeErrorCallable(e, 'No se pudo enviar la convocatoria.'), 'error');
        } finally {
            setSending(false);
        }
    }

    // Derivados del servicio seleccionado (selectedSrvId='' = todos los servicios)
    const srvSols = selectedSrvId ? solicitudes.filter(s => s.servicioId === selectedSrvId) : solicitudes;
    const aprobadas = srvSols.filter(s => s.status === 'aprobada');
    /** Asignación directa (libre/RET): no es una aceptación. */
    const asignadosDirecto = aprobadas.filter(s => s.tipo === 'admin_asigna');
    const aceptaron = aprobadas.filter(s => s.tipo !== 'admin_asigna');
    const pendientes = srvSols.filter(s => s.status === 'convocado' || s.status === 'pendiente');
    const rechazaron = srvSols.filter(s => s.status === 'rechazada');
    /** Eventuales que no respondieron en el plazo: no generaron nada, el lugar quedó libre. */
    const vencieron = srvSols.filter(s => s.status === 'vencida');
    const noVan = srvSols.filter(s => s.status === 'cancelada');
    /** El cupo de su grupo se llenó antes de que respondieran: se les avisó, no se generó nada. */
    const cupoCompletos = srvSols.filter(s => s.status === 'cupo_completo');
    const yaEnviadosIds = new Set(srvSols.filter(s => s.status !== 'cupo_completo').map(s => s.empleadoId));
    /** Turno EV del eventual que aceptó (anexo/ARCA en «Estado convocatoria»). */
    const turnoEvDe = (sol: SolicitudEvento) => evTurnos.find(t => t.servicioId === sol.servicioId && (t.employeeId === sol.empleadoId || (sol.bolsaCuil && t.bolsaCuil === sol.bolsaCuil))) || null;

    // EV turnos del servicio sin solicitud correspondiente (asignados directo desde planificador)
    const srvEvTurnos = evTurnos.filter(t => selectedSrvId ? t.servicioId === selectedSrvId : true);
    const solsEmpleadoIds = new Set(srvSols.map(s => s.empleadoId));
    const turnosDirectos = srvEvTurnos.filter(t => !solsEmpleadoIds.has(t.employeeId));
    const totalConfirmados = aprobadas.length + turnosDirectos.length;

    const cupo = selectedSrv?.cupo || 0;
    /** Cupo por género (o indistinto) del servicio elegido: ocupación por grupo. */
    const porGenero = !!selectedSrv && (esPorGenero(selectedSrv) as boolean);
    const generoDeEmpleado = (empleadoId: string) => empleados.find(e => e.id === empleadoId)?.genero || '';
    const confirmadosItems = [
        ...aprobadas.map(s => ({ genero: s.genero || generoDeEmpleado(s.empleadoId), cupoGrupo: s.cupoGrupo || '' })),
        ...turnosDirectos.map(t => ({ genero: t.genero || generoDeEmpleado(String(t.employeeId || '')), cupoGrupo: t.cupoGrupo || '' })),
    ];
    const cupoEstado = selectedSrv ? (estadoCupo(selectedSrv, confirmadosItems) as { grupos: GrupoCupoUi[]; cupo: number; ocupados: number; completo: boolean }) : null;
    const cupoLleno = cupo > 0 && (cupoEstado ? cupoEstado.completo : totalConfirmados >= cupo);
    /** Grupo (M/F) de cada guardia de nómina según el servicio; `null` = sin especificar en un servicio por género. */
    const grupoDeEmp = (emp: EmpRow) => (selectedSrv ? (grupoDeGenero(selectedSrv, emp.genero) as string | null) : 'TODOS');

    const aptitudesRequeridas = selectedSrv?.aptitudesRequeridas || [];

    function cumpleRequisitos(emp: EmpRow): boolean {
        if (aptitudesRequeridas.length === 0) return true;
        const empCodigos = new Set((emp.aptitudes || []).map(a => a.codigo));
        return aptitudesRequeridas.every(c => empCodigos.has(c));
    }

    const availCounts = {
        todos:    empleados.length,
        libre:    empleados.filter(e => (availMap[e.id] || 'libre') === 'libre').length,
        RET:      empleados.filter(e => availMap[e.id] === 'RET').length,
        franco:   empleados.filter(e => FRANCO_CODES.has(availMap[e.id] || '')).length,
        conTurno: empleados.filter(e => CON_TURNO_CODES.has(availMap[e.id] || '')).length,
    };

    const filteredEmps = empleados.filter(e => {
        if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
        if (soloRequisitos && !cumpleRequisitos(e)) return false;
        if (filterAvail !== 'todos') {
            const code = availMap[e.id] || 'libre';
            if (filterAvail === 'libre'    && code !== 'libre') return false;
            if (filterAvail === 'RET'      && code !== 'RET') return false;
            if (filterAvail === 'franco'   && !FRANCO_CODES.has(code)) return false;
            if (filterAvail === 'conTurno' && !CON_TURNO_CODES.has(code)) return false;
        }
        return true;
    });

    function toggleEmp(id: string) {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200 dark:border-slate-700 shrink-0">
                    <div className="min-w-0">
                        <h2 className="text-base font-black text-slate-800 dark:text-white truncate">{evento.nombre}</h2>
                        <p className="text-[11px] text-slate-400">{evento.clienteNombre}</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
                        <X size={16}/>
                    </button>
                </div>

                <div className="flex flex-1 overflow-hidden min-h-0">

                    {/* Sidebar: lista de servicios */}
                    <div className="w-52 shrink-0 border-r border-slate-200 dark:border-slate-700 flex flex-col">
                        <p className="px-3 pt-3 pb-1.5 text-[9px] font-black uppercase text-slate-400 tracking-widest">Servicios</p>
                        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1.5">
                            {(evento.servicios || []).length > 1 && (
                                <button
                                    onClick={() => { setSelectedSrvId(''); setTab('estado'); setSearch(''); setSelected(new Set()); }}
                                    className={`w-full text-left px-3 py-2 rounded-lg border transition-all ${selectedSrvId === '' ? 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}
                                >
                                    <div className="flex items-center justify-between gap-1">
                                        <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Todos</p>
                                        {selectedSrvId === '' && <span className="w-1 h-1 rounded-full bg-slate-500 dark:bg-slate-400 shrink-0"/>}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        {evTurnos.length > 0 && <span className="text-[9px] text-emerald-600 dark:text-emerald-400">{evTurnos.length} asignados</span>}
                                        <span className="text-[9px] text-slate-400 ml-auto">{(evento.servicios || []).reduce((n, s) => n + (s.cupo || 0), 0)} pax</span>
                                    </div>
                                </button>
                            )}
                            {(evento.servicios || []).map(srv => {
                                const sSols = solicitudes.filter(s => s.servicioId === srv.id);
                                const pend = sSols.filter(s => s.status === 'convocado' || s.status === 'pendiente').length;
                                const srvTotalAsig = evTurnos.filter(t => t.servicioId === srv.id).length;
                                const isActive = srv.id === selectedSrvId;
                                return (
                                    <button
                                        key={srv.id}
                                        onClick={() => { setSelectedSrvId(srv.id); setTab('convocar'); setSearch(''); setSelected(new Set()); setFilterAvail('todos'); }}
                                        className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${isActive ? 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}
                                    >
                                        <div className="flex items-center justify-between gap-1">
                                            <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 leading-tight truncate">{srv.nombre}</p>
                                            {isActive && <span className="w-1 h-1 rounded-full bg-slate-500 dark:bg-slate-400 shrink-0"/>}
                                        </div>
                                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                                            <span className="text-[9px] text-slate-400 flex items-center gap-0.5"><Calendar size={7}/>{fmtFecha(srv.fecha)}</span>
                                            <span className="text-[9px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1 py-0.5 rounded font-medium">{horarioBadge(srv)}</span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                            {pend > 0 && <span className="text-[9px] text-amber-600 dark:text-amber-400">{pend} pend.</span>}
                                            {srvTotalAsig > 0 && <span className="text-[9px] text-emerald-600 dark:text-emerald-400">{srvTotalAsig} asignados</span>}
                                            <span className="text-[9px] text-slate-400 ml-auto" data-srv-cupo={srv.id}>{textoCupoServicio(srv)}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Panel principal */}
                    {(selectedSrv || selectedSrvId === '') ? (
                        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

                            {/* Cabecera del servicio */}
                            {selectedSrv ? (
                            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 shrink-0">
                                <div className="flex flex-wrap items-center gap-2.5">
                                    <span className="font-semibold text-slate-800 dark:text-white text-sm">{selectedSrv.nombre}</span>
                                    <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded font-medium">{horarioBadge(selectedSrv)}</span>
                                    <span className="text-[10px] text-slate-400 flex items-center gap-1"><Calendar size={9}/>{fmtFecha(selectedSrv.fecha)}</span>
                                    <span className="text-[10px] text-slate-400 flex items-center gap-1" data-cabecera-cupo><Users size={9}/>{textoCupoServicio(selectedSrv)}</span>
                                    {selectedSrv.ubicacion?.direccion && (
                                        <span className="text-[10px] text-slate-400 flex items-center gap-1 truncate max-w-[200px]"><MapPin size={9}/>{selectedSrv.ubicacion.direccion}</span>
                                    )}
                                </div>
                                {aptitudesRequeridas.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                        <span className="text-[9px] font-black uppercase text-slate-400">Requiere:</span>
                                        {aptitudesRequeridas.map(codigo => {
                                            const apt = aptitudCatalog.find(a => a.codigo === codigo);
                                            return (
                                                <span key={codigo} className="inline-flex items-center gap-1 text-[9px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded-full">
                                                    {apt?.icono} {apt?.nombre || codigo}
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}
                                {/* Barra progreso confirmados (por grupo si el cupo es por género) */}
                                {porGenero && cupoEstado ? (
                                    <div className="mt-2" data-cabecera-cupo-grupos>
                                        <CupoGruposBarra grupos={cupoEstado.grupos} compact />
                                    </div>
                                ) : (
                                <div className="mt-2 flex items-center gap-2">
                                    <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-emerald-500 rounded-full transition-all"
                                            style={{ width: cupo > 0 ? `${Math.min(100, Math.round(totalConfirmados / cupo * 100))}%` : '0%' }}
                                        />
                                    </div>
                                    <span className="text-[9px] text-slate-400 shrink-0">{totalConfirmados}/{cupo} confirmados</span>
                                </div>
                                )}
                            </div>
                            ) : (
                            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 shrink-0">
                                <div className="flex flex-wrap items-center gap-2.5">
                                    <span className="font-semibold text-slate-800 dark:text-white text-sm">Todos los servicios</span>
                                    <span className="text-[10px] text-slate-400 flex items-center gap-1"><Users size={9}/>{(evento.servicios || []).reduce((n, s) => n + (s.cupo || 0), 0)} pax total</span>
                                </div>
                                <div className="mt-2 flex items-center gap-2">
                                    <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: (() => { const tot = (evento.servicios || []).reduce((n, s) => n + (s.cupo || 0), 0); return tot > 0 ? `${Math.min(100, Math.round(evTurnos.length / tot * 100))}%` : '0%'; })() }}/>
                                    </div>
                                    <span className="text-[9px] text-slate-400 shrink-0">{evTurnos.length}/{(evento.servicios || []).reduce((n, s) => n + (s.cupo || 0), 0)} confirmados</span>
                                </div>
                            </div>
                            )}

                            {/* Tabs */}
                            <div className="flex border-b border-slate-200 dark:border-slate-700 px-4 shrink-0">
                                {(['convocar', 'estado', 'cronograma'] as const)
                                    .filter(t => !(t === 'convocar' && !selectedSrv))
                                    .map(t => {
                                    const cronoCount = selectedSrvId
                                        ? evTurnos.filter(x => x.servicioId === selectedSrvId).length
                                        : evTurnos.length;
                                    return (
                                    <button
                                        key={t}
                                        onClick={() => setTab(t)}
                                        className={`px-4 py-2.5 text-[11px] font-medium transition-colors border-b-2 flex items-center gap-1.5 ${tab === t ? 'border-slate-700 dark:border-slate-300 text-slate-700 dark:text-slate-200' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                    >
                                        {t === 'convocar' ? 'Convocar guardias' : t === 'estado' ? 'Estado convocatoria' : 'Cronograma'}
                                        {t === 'estado' && srvSols.length > 0 && (
                                            <span className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full px-1.5 py-0.5 text-[8px]">{srvSols.length}</span>
                                        )}
                                        {t === 'cronograma' && cronoCount > 0 && (
                                            <span className="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 rounded-full px-1.5 py-0.5 text-[8px]">{cronoCount}</span>
                                        )}
                                    </button>
                                    );
                                })}
                            </div>

                            {/* Tab: Convocar */}
                            {tab === 'convocar' && (
                                <div className="flex-1 flex flex-col overflow-hidden">
                                    {cupoLleno ? (
                                        <div className="m-4 flex flex-col items-center justify-center gap-2 py-10 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-center">
                                            <CheckCircle size={28} className="text-emerald-500"/>
                                            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Cupo completo</p>
                                            <p className="text-xs text-emerald-600 dark:text-emerald-400">{totalConfirmados}/{cupo} guardias confirmados ({asignadosDirecto.length} asignados y notificados, {aceptaron.length} aceptaron).</p>
                                            {porGenero && cupoEstado && <p className="text-[10px] text-emerald-700 dark:text-emerald-300" data-cupo-completo-grupos>{textoResumenCupo(cupoEstado)}</p>}
                                            <p className="text-[10px] text-slate-400 mt-1">Para agregar más, editá el cupo del servicio.</p>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex border-b border-slate-100 dark:border-slate-800 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => setFuente('eventuales')}
                                                    className={`flex-1 py-2 text-[10px] font-black transition-colors ${fuente === 'eventuales' ? 'border-b-2 border-fuchsia-600 text-fuchsia-700' : 'text-slate-500 hover:text-slate-700'}`}
                                                >
                                                    Eventuales (bolsa)
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setFuente('nomina')}
                                                    className={`flex-1 py-2 text-[10px] font-black transition-colors ${fuente === 'nomina' ? 'border-b-2 border-slate-700 text-slate-800 dark:text-slate-100' : 'text-slate-500 hover:text-slate-700'}`}
                                                >
                                                    Nómina
                                                </button>
                                            </div>
                                            {fuente === 'eventuales' && selectedSrv && (() => {
                                                const horas = selectedSrv.tipoTurno === '3x8' ? 8 : selectedSrv.tipoTurno === '2x12' ? 12 : calcHorasServicio(selectedSrv.horaInicio, selectedSrv.horaFin);
                                                const jornada = { fecha: selectedSrv.fecha, horaInicio: selectedSrv.horaInicio || '08:00', horaFin: selectedSrv.horaFin || '16:00', horas };
                                                const asignarEventual = async (candidato: { cuil: string; nombre: string }) => {
                                                    setEventualBusy(true);
                                                    setEventualError(null);
                                                    try {
                                                        // Convocatoria, nunca asignación directa: turno EV, contrato, AT y anexo recién cuando acepta en la app.
                                                        const res = await convocarEventualEvento({
                                                            empresaId,
                                                            cuil: candidato.cuil,
                                                            jornada,
                                                            clientId: evento.clienteId || null,
                                                            clientName: evento.clienteNombre || null,
                                                            positionName: selectedSrv.nombre || 'Evento',
                                                            evento: { eventoId: evento.id!, eventoNombre: evento.nombre, servicioId: selectedSrv.id, servicioNombre: selectedSrv.nombre },
                                                        });
                                                        setUltimoEventual(null);
                                                        addToast(`${candidato.nombre.split(',')[0]} (eventual) convocado a ${selectedSrv.nombre}: tiene que aceptar en la app${res.pruebasSinMarco ? ' · Pruebas: sin exigir marco' : ''}`, 'success');
                                                    } catch (e) {
                                                        setUltimoEventual(candidato);
                                                        setEventualError(mensajeErrorCallable(e, `No se pudo convocar a ${candidato.nombre.split(',')[0]} (eventual).`));
                                                    } finally {
                                                        setEventualBusy(false);
                                                    }
                                                };
                                                return (
                                                    <div className="flex-1 overflow-hidden flex flex-col px-3 py-3">
                                                        <p className="text-[9px] font-bold text-fuchsia-800 bg-fuchsia-50 border border-fuchsia-100 rounded-lg px-3 py-1.5 mb-2 shrink-0">
                                                            {selectedSrv.nombre} · {fmtFecha(selectedSrv.fecha)} · {jornada.horaInicio}–{jornada.horaFin} ({horas}h). El eventual se convoca y tiene que aceptar en la app. Recién al aceptar: turno EV, anexo al marco (código por app/mail) y alta ARCA (urgente si es en menos de 24 h). Si rechaza o no responde, no se genera nada y el lugar queda libre.
                                                        </p>
                                                        {eventualError && (
                                                            <div className="mb-2 shrink-0">
                                                                <ErrorCallableBox
                                                                    mensaje={eventualError}
                                                                    onReintentar={ultimoEventual ? () => { void asignarEventual(ultimoEventual); } : undefined}
                                                                />
                                                            </div>
                                                        )}
                                                        <EventualesCandidatosPanel
                                                            empresaId={empresaId}
                                                            objectiveId={null}
                                                            clientId={evento.clienteId || null}
                                                            jornadas={[jornada]}
                                                            canConvocar={canConvocarEventual}
                                                            busy={eventualBusy}
                                                            onSelect={(candidato) => { void asignarEventual(candidato); }}
                                                            cupo={porGenero && cupoEstado ? { servicio: selectedSrv, grupos: cupoEstado.grupos } : null}
                                                        />
                                                    </div>
                                                );
                                            })()}
                                            <div className={`px-4 pt-3 pb-2 flex items-center gap-3 shrink-0 border-b border-slate-100 dark:border-slate-800 flex-wrap ${fuente === 'eventuales' ? 'hidden' : ''}`}>
                                                <div className="relative flex-1 min-w-32">
                                                    <Search size={11} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                                                    <input
                                                        value={search}
                                                        onChange={e => setSearch(e.target.value)}
                                                        placeholder="Buscar guardia…"
                                                        className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 outline-none focus:border-slate-400 dark:focus:border-slate-500"
                                                    />
                                                </div>
                                                {aptitudesRequeridas.length > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setSoloRequisitos(v => !v)}
                                                        className={`px-2.5 py-1.5 rounded-lg text-[10px] font-medium border transition-colors ${soloRequisitos ? 'bg-slate-700 dark:bg-slate-300 border-slate-700 dark:border-slate-300 text-white dark:text-slate-900' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:border-slate-400'}`}
                                                    >
                                                        Solo cumplen requisitos
                                                    </button>
                                                )}
                                                {(() => {
                                                    const plan = selected.size > 0 ? planActual() : null;
                                                    const n = plan?.notificar.length || 0;
                                                    const m = plan?.convocar.length || 0;
                                                    return (
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            {plan && (n > 0 || m > 0) && (
                                                                <span className="hidden sm:flex items-center gap-1" data-plan-contadores={`${n}/${m}`}>
                                                                    {n > 0 && <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-400">{n} se notifica{n === 1 ? '' : 'n'}</span>}
                                                                    {n > 0 && m > 0 && <span className="text-[9px] text-slate-300">·</span>}
                                                                    {m > 0 && <span className="text-[9px] font-bold text-amber-700 dark:text-amber-400">{m} se convoca{m === 1 ? '' : 'n'}</span>}
                                                                </span>
                                                            )}
                                                            <button
                                                                onClick={() => setRevisando(true)}
                                                                disabled={selected.size === 0 || sending || revisando}
                                                                className="flex items-center gap-2 px-4 py-2 bg-slate-800 dark:bg-slate-200 hover:bg-slate-700 dark:hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed text-white dark:text-slate-900 rounded-lg text-xs font-medium transition-colors shrink-0"
                                                            >
                                                                <Send size={11}/>
                                                                {sending ? 'Enviando…' : `Revisar y enviar${selected.size > 0 ? ` (${selected.size})` : ''}`}
                                                            </button>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                            {revisando && selectedSrv && fuente === 'nomina' && (
                                                <ConvocatoriaResumen
                                                    plan={planActual()}
                                                    servicio={{ nombre: selectedSrv.nombre, fecha: fmtFecha(selectedSrv.fecha), horario: horarioBadge(selectedSrv) }}
                                                    sending={sending}
                                                    onCancelar={() => setRevisando(false)}
                                                    onConfirmar={() => void handleConvocar()}
                                                />
                                            )}
                                            {/* Filtros de disponibilidad */}
                                            {!loadingAvail && fuente === 'nomina' && !revisando && (
                                                <div className="px-4 py-2 flex items-center gap-1.5 flex-wrap border-b border-slate-100 dark:border-slate-800 shrink-0">
                                                    {([
                                                        { key: 'todos',    label: 'Todos' },
                                                        { key: 'libre',    label: 'Sin turno' },
                                                        { key: 'RET',      label: 'RET' },
                                                        { key: 'franco',   label: 'Franco' },
                                                        { key: 'conTurno', label: 'Con turno' },
                                                    ] as const).map(({ key, label }) => {
                                                        const count = availCounts[key];
                                                        return (
                                                            <button
                                                                key={key}
                                                                onClick={() => setFilterAvail(key)}
                                                                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${filterAvail === key ? 'bg-slate-700 dark:bg-slate-300 text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
                                                            >
                                                                {label}
                                                                {count > 0 && <span className={`font-mono tabular-nums ${filterAvail === key ? 'opacity-70' : 'opacity-50'}`}>{count}</span>}
                                                            </button>
                                                        );
                                                    })}
                                                    <span className="ml-auto flex items-center gap-1.5 text-[9px] text-slate-400">
                                                        <AccionChip accion="NOTIFICAR" size="xs" /> libre / RET: asignación directa
                                                        <AccionChip accion="CONVOCAR" size="xs" /> tiene que aceptar
                                                    </span>
                                                </div>
                                            )}
                                            <div className={`flex-1 overflow-y-auto px-4 py-3 space-y-1.5 ${fuente === 'eventuales' || revisando ? 'hidden' : ''}`}>
                                                {loadingAvail && (
                                                    <p className="text-[11px] text-slate-400 text-center py-4">Cargando disponibilidad…</p>
                                                )}
                                                {!loadingAvail && (() => {
                                                    const renderEmp = (emp: EmpRow, sinGrupo = false) => {
                                                    const code = availMap[emp.id] || 'libre';
                                                    const situacion = situacionDelDia(code, horarioMap[emp.id] || '');
                                                    const solPrevia = srvSols.find((s) => s.empleadoId === emp.id && s.status !== 'cupo_completo');
                                                    const yaEnviado = yaEnviadosIds.has(emp.id);
                                                    const isChecked = selected.has(emp.id);
                                                    const disponible = DISPONIBLE_CODES.has(code);
                                                    // Sin género en un servicio por género: no se puede convocar hasta completar el legajo.
                                                    const clickable = !yaEnviado && disponible && !sinGrupo;
                                                    return (
                                                        <div
                                                            key={emp.id}
                                                            data-emp-grupo={sinGrupo ? 'SIN_ESPECIFICAR' : (grupoDeEmp(emp) || 'TODOS')}
                                                            title={sinGrupo ? 'Sin género en el legajo: completalo para convocarlo (cupo por género).' : undefined}
                                                            onClick={() => clickable && toggleEmp(emp.id)}
                                                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors
                                                                ${isChecked
                                                                    ? 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600'
                                                                    : yaEnviado
                                                                        ? 'bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800 opacity-60'
                                                                        : disponible && !sinGrupo
                                                                            ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer'
                                                                            : 'bg-slate-50 dark:bg-slate-800/30 border-slate-100 dark:border-slate-800 opacity-40 cursor-not-allowed'
                                                                }`}
                                                        >
                                                            {/* Checkbox */}
                                                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${isChecked ? 'bg-slate-700 dark:bg-slate-300 border-slate-700 dark:border-slate-300' : 'border-slate-300 dark:border-slate-600'}`}>
                                                                {isChecked && <CheckCircle size={10} className="text-white"/>}
                                                            </div>
                                                            {/* Nombre */}
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-xs font-black text-slate-700 dark:text-slate-200 truncate">{emp.name}</p>
                                                                {emp.fileNumber && <p className="text-[9px] text-slate-400">Leg. {emp.fileNumber}</p>}
                                                            </div>
                                                            {/* Chips aptitudes */}
                                                            {(emp.aptitudes || []).length > 0 && (
                                                                <div className="flex flex-wrap gap-0.5 max-w-[120px]">
                                                                    {(emp.aptitudes || []).slice(0, 3).map(a => {
                                                                        const apt = aptitudCatalog.find(t => t.codigo === a.codigo);
                                                                        const cumple = aptitudesRequeridas.includes(a.codigo);
                                                                        return (
                                                                            <span
                                                                                key={a.codigo}
                                                                                title={apt?.nombre || a.codigo}
                                                                                className={`text-[8px] px-1 py-0.5 rounded font-bold ${cumple ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}
                                                                            >
                                                                                {apt?.icono || a.codigo}
                                                                            </span>
                                                                        );
                                                                    })}
                                                                    {(emp.aptitudes || []).length > 3 && (
                                                                        <span className="text-[8px] text-slate-400">+{(emp.aptitudes || []).length - 3}</span>
                                                                    )}
                                                                </div>
                                                            )}
                                                            {/* Situación del día + qué va a pasar (Se notifica / Se convoca) */}
                                                            <SituacionAccionBadges
                                                                situacion={situacion}
                                                                yaEnviado={yaEnviado ? (solPrevia?.tipo === 'admin_asigna' ? 'ASIGNADO' : 'CONVOCADO') : null}
                                                            />
                                                        </div>
                                                    );
                                                    };
                                                    if (!porGenero || !selectedSrv) return filteredEmps.map((emp) => renderEmp(emp));
                                                    // Cupo por género: dos grupos (Hombres n/X · Mujeres n/Y) + «Sin especificar» aparte.
                                                    const agrupado = agruparCandidatos(selectedSrv, filteredEmps, confirmadosItems) as {
                                                        grupos: (GrupoCupoUi & { candidatos: EmpRow[] })[];
                                                        sinEspecificar: EmpRow[];
                                                    };
                                                    return (
                                                        <>
                                                            {agrupado.grupos.map((g) => (
                                                                <div key={g.grupo} className="space-y-1.5 -mx-4" data-nomina-grupo={g.grupo}>
                                                                    <GrupoCandidatosHeader grupo={g} cantidad={g.candidatos.length} />
                                                                    <div className="px-4 space-y-1.5">
                                                                        {g.candidatos.length === 0 && <p className="text-[10px] text-slate-400 py-1">Sin candidatos en este grupo.</p>}
                                                                        {g.candidatos.map((emp) => renderEmp(emp))}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                            {agrupado.sinEspecificar.length > 0 && (
                                                                <div className="space-y-1.5 -mx-4" data-nomina-grupo="SIN_ESPECIFICAR">
                                                                    <SinEspecificarAviso cantidad={agrupado.sinEspecificar.length} />
                                                                    <div className="px-4 space-y-1.5">{agrupado.sinEspecificar.map((emp) => renderEmp(emp, true))}</div>
                                                                </div>
                                                            )}
                                                        </>
                                                    );
                                                })()}
                                                {!loadingAvail && filteredEmps.length === 0 && (
                                                    <p className="text-[11px] text-slate-400 text-center py-8">Sin resultados</p>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Tab: Cronograma */}
                            {tab === 'cronograma' && (
                                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                                    {loadingCrono ? (
                                        <p className="text-[11px] text-slate-400 text-center py-10">Cargando…</p>
                                    ) : evTurnos.length === 0 ? (
                                        <p className="text-[11px] text-slate-400 text-center py-10">
                                            Sin guardias asignados aún. Confirmá convocatorias desde "Estado convocatoria".
                                        </p>
                                    ) : (
                                        (selectedSrvId
                                            ? (evento.servicios || []).filter(s => s.id === selectedSrvId)
                                            : (evento.servicios || [])
                                        ).map(srv => {
                                            const srvT = evTurnos.filter(t => t.servicioId === srv.id);
                                            if (srvT.length === 0) return null;
                                            const selectedSrvTurnos = srvT.filter((t) => selectedCronoTurnos.has(t.id));
                                            return (
                                                <section key={srv.id}>
                                                    <div className="mb-2 flex items-center gap-2 flex-wrap">
                                                        <p className="text-[9px] font-black uppercase text-slate-400 tracking-wide flex items-center gap-1.5">
                                                            <span>{srv.nombre}</span>
                                                            <span className="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded font-black">{fmtFecha(srv.fecha)}</span>
                                                            <span className="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded font-medium">{horarioBadge(srv)}</span>
                                                        </p>
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleUnassignMany(srvT, `del servicio "${srv.nombre}"`)}
                                                            className="text-[10px] font-black uppercase text-rose-500 hover:text-rose-700 px-2 py-1 rounded-lg hover:bg-rose-50"
                                                        >
                                                            Desasignar todos
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={selectedSrvTurnos.length === 0}
                                                            onClick={() => void handleUnassignMany(selectedSrvTurnos, `seleccionado(s) de "${srv.nombre}"`)}
                                                            className="text-[10px] font-black uppercase text-amber-600 hover:text-amber-800 px-2 py-1 rounded-lg hover:bg-amber-50 disabled:opacity-40"
                                                        >
                                                            Desasignar selección ({selectedSrvTurnos.length})
                                                        </button>
                                                    </div>
                                                    {(srv.cupo || 0) > 0 && (
                                                        <div className="mb-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2" data-crono-cupo={srv.id}>
                                                            <CupoGruposBarra
                                                                compact
                                                                grupos={(estadoCupo(srv, srvT.map(t => ({ genero: t.genero || generoDeEmpleado(String(t.employeeId || '')), cupoGrupo: t.cupoGrupo || '' }))) as { grupos: GrupoCupoUi[] }).grupos}
                                                            />
                                                        </div>
                                                    )}
                                                    <div className="space-y-1.5">
                                                        {srvT.map(turno => (
                                                            <div key={turno.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
                                                                <input
                                                                    type="checkbox"
                                                                    className="h-3.5 w-3.5 rounded border-slate-300"
                                                                    checked={selectedCronoTurnos.has(turno.id)}
                                                                    onChange={(e) => {
                                                                        const next = new Set(selectedCronoTurnos);
                                                                        if (e.target.checked) next.add(turno.id);
                                                                        else next.delete(turno.id);
                                                                        setSelectedCronoTurnos(next);
                                                                    }}
                                                                />
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-xs font-black text-slate-700 dark:text-slate-200 truncate">
                                                                        {resolveTurnoGuardName(turno)}
                                                                    </p>
                                                                    <p className="text-[9px] text-slate-400">
                                                                        {(() => {
                                                                            const fmt = (t: any) => {
                                                                                if (!t) return '—';
                                                                                if (typeof t.toDate === 'function') {
                                                                                    const d = t.toDate();
                                                                                    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                                                                                }
                                                                                return String(t).slice(11, 16) || '—';
                                                                            };
                                                                            return `${fmt(turno.startTime)}–${fmt(turno.endTime)}`;
                                                                        })()}
                                                                        {turno.replacedCode ? ` · reemplaza ${turno.replacedCode}` : ''}
                                                                    </p>
                                                                </div>
                                                                <div className="flex items-center gap-1 shrink-0">
                                                                    <button
                                                                        onClick={() => void handleTogglePresence(turno.id, 'isPresent', !turno.isPresent)}
                                                                        title="Marcar presente"
                                                                        className={`p-1.5 rounded-lg transition-colors ${turno.isPresent ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-400 hover:bg-emerald-50'}`}
                                                                    >
                                                                        <UserCheck size={13}/>
                                                                    </button>
                                                                    <button
                                                                        onClick={() => void handleTogglePresence(turno.id, 'isAbsent', !turno.isAbsent)}
                                                                        title="Marcar ausente"
                                                                        className={`p-1.5 rounded-lg transition-colors ${turno.isAbsent ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-400 hover:bg-rose-50'}`}
                                                                    >
                                                                        <UserX size={13}/>
                                                                    </button>
                                                                    <button
                                                                        onClick={() => void handleTogglePresence(turno.id, 'isCompleted', !turno.isCompleted)}
                                                                        title="Marcar completado"
                                                                        className={`p-1.5 rounded-lg transition-colors ${turno.isCompleted ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-400 hover:bg-blue-50'}`}
                                                                    >
                                                                        <ClipboardCheck size={13}/>
                                                                    </button>
                                                                    <button
                                                                        onClick={() => void handleUnassignGuard(turno)}
                                                                        title="Desasignar del evento"
                                                                        className="p-1.5 rounded-lg transition-colors bg-slate-100 dark:bg-slate-700 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30 dark:hover:text-rose-400"
                                                                    >
                                                                        <UserMinus size={13}/>
                                                                    </button>
                                                                </div>
                                                                <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-black shrink-0 ${
                                                                    turno.isCompleted ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' :
                                                                    turno.isPresent   ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' :
                                                                    turno.isAbsent    ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400' :
                                                                    'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
                                                                }`}>
                                                                    {turno.isCompleted ? 'Completó' : turno.isPresent ? 'Presente' : turno.isAbsent ? 'Ausente' : 'Sin fichar'}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            );
                                        })
                                    )}
                                </div>
                            )}

                            {/* Tab: Estado */}
                            {tab === 'estado' && (
                                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                                    {srvSols.length === 0 && turnosDirectos.length === 0 ? (
                                        <p className="text-[11px] text-slate-400 text-center py-10">Sin convocatorias. Seleccioná un servicio y usá "Convocar guardias" para invitar.</p>
                                    ) : !selectedSrvId ? (
                                        // Modo "todos": agrupar por servicio
                                        (evento.servicios || []).map(srv => {
                                            const sSols = solicitudes.filter(s => s.servicioId === srv.id);
                                            const sSolsIds = new Set(sSols.map(s => s.empleadoId));
                                            const sTurnDir = evTurnos.filter(t => t.servicioId === srv.id && !sSolsIds.has(t.employeeId));
                                            if (sSols.length === 0 && sTurnDir.length === 0) return null;
                                            return (
                                                <section key={srv.id}>
                                                    <p className="text-[9px] font-black uppercase text-slate-400 tracking-wide mb-2 flex items-center gap-1.5">
                                                        <span>{srv.nombre}</span>
                                                        <span className="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded font-black">{fmtFecha(srv.fecha)}</span>
                                                    </p>
                                                    <div className="space-y-1">
                                                        {sSols.map(sol => (
                                                            <div key={sol.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg">
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{sol.empleadoNombre}</p>
                                                                    <EventualEstadoLinea sol={sol} turno={turnoEvDe(sol)} />
                                                                </div>
                                                                <EstadoSolicitudChip sol={sol} />
                                                            </div>
                                                        ))}
                                                        {sTurnDir.map(t => (
                                                            <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg">
                                                                <CheckCircle size={12} className="text-emerald-500 shrink-0"/>
                                                                <p className="text-xs font-medium text-slate-700 dark:text-slate-200 flex-1">
                                                                    {resolveTurnoGuardName(t)}
                                                                </p>
                                                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Planificador</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            );
                                        })
                                    ) : (
                                        <>
                                            {cupo > 0 && cupoEstado && (
                                                <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2" data-estado-cupo>
                                                    <p className="text-[9px] font-black uppercase text-slate-400 tracking-wide mb-1.5">
                                                        Cupo · {textoResumenCupo(cupoEstado)}{porGenero ? ' · se llena por orden de aceptación' : ''}
                                                    </p>
                                                    <CupoGruposBarra grupos={cupoEstado.grupos} />
                                                </section>
                                            )}
                                            {asignadosDirecto.length > 0 && (
                                                <section>
                                                    <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">Asignados (notificados) — {asignadosDirecto.length}</p>
                                                    <div className="space-y-1">
                                                        {asignadosDirecto.map(sol => (
                                                            <div key={sol.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg">
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{sol.empleadoNombre}</p>
                                                                    <p className="text-[9px] text-slate-400">Libre o RET: asignación directa, no tenía que aceptar</p>
                                                                </div>
                                                                <EstadoSolicitudChip sol={sol} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}
                                            {aceptaron.length > 0 && (
                                                <section>
                                                    <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">Aceptaron — {aceptaron.length}</p>
                                                    <div className="space-y-1">
                                                        {aceptaron.map(sol => (
                                                            <div key={sol.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg">
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{sol.empleadoNombre}</p>
                                                                    <EventualEstadoLinea sol={sol} turno={turnoEvDe(sol)} />
                                                                </div>
                                                                <EstadoSolicitudChip sol={sol} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}
                                            {turnosDirectos.length > 0 && (
                                                <section>
                                                    <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">Asignados desde planificador — {turnosDirectos.length}</p>
                                                    <div className="space-y-1">
                                                        {turnosDirectos.map(t => (
                                                            <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg">
                                                                <CheckCircle size={12} className="text-emerald-500 shrink-0"/>
                                                                <p className="text-xs font-medium text-slate-700 dark:text-slate-200 flex-1">
                                                                    {resolveTurnoGuardName(t)}
                                                                </p>
                                                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Planificador</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}
                                            {pendientes.length > 0 && (
                                                <section>
                                                    <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">Pendientes — {pendientes.length}</p>
                                                    <div className="space-y-1">
                                                        {pendientes.map(sol => (
                                                            <div key={sol.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg">
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{sol.empleadoNombre}</p>
                                                                    <p className="text-[9px] text-slate-400">{sol.tipo === 'admin_convoca' ? (sol.esEventual ? 'Eventual convocado: tiene que aceptar desde la app (si no responde, vence y el lugar queda libre)' : 'Convocado, tiene que aceptar desde la app') : 'Solicitó participar'}</p>
                                                                    <EventualEstadoLinea sol={sol} />
                                                                </div>
                                                                <EstadoSolicitudChip sol={sol} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}
                                            {rechazaron.length > 0 && (
                                                <section>
                                                    <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">Rechazaron — {rechazaron.length}</p>
                                                    <div className="space-y-1">
                                                        {rechazaron.map(sol => (
                                                            <div key={sol.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg">
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{sol.empleadoNombre}</p>
                                                                    <EventualEstadoLinea sol={sol} />
                                                                </div>
                                                                <EstadoSolicitudChip sol={sol} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}
                                            {noVan.length > 0 && (
                                                <section>
                                                    <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">Avisaron que no pueden asistir — {noVan.length}</p>
                                                    <div className="space-y-1">
                                                        {noVan.map(sol => (
                                                            <div key={sol.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg">
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{sol.empleadoNombre}</p>
                                                                    <p className="text-[9px] text-slate-400">Canceló antes del inicio. El anexo quedó sin efecto y se reconvocó el lugar.</p>
                                                                    <EventualEstadoLinea sol={sol} turno={turnoEvDe(sol)} />
                                                                </div>
                                                                <EstadoSolicitudChip sol={sol} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}
                                            {cupoCompletos.length > 0 && (
                                                <section data-estado-cupo-completos={cupoCompletos.length}>
                                                    <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">Cupo completo antes de responder — {cupoCompletos.length}</p>
                                                    <div className="space-y-1">
                                                        {cupoCompletos.map(sol => (
                                                            <div key={sol.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg">
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{sol.empleadoNombre}</p>
                                                                    <p className="text-[9px] text-slate-400">El cupo{sol.cupoGrupo === 'M' ? ' de hombres' : sol.cupoGrupo === 'F' ? ' de mujeres' : ''} se llenó antes de que respondiera. Se le avisó «Ya se cubrió el cupo, gracias»; no se generó turno, contrato, anexo ni alta.</p>
                                                                    <EventualEstadoLinea sol={sol} />
                                                                </div>
                                                                <EstadoSolicitudChip sol={sol} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}
                                            {vencieron.length > 0 && (
                                                <section>
                                                    <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">Vencieron sin responder — {vencieron.length}</p>
                                                    <div className="space-y-1">
                                                        {vencieron.map(sol => (
                                                            <div key={sol.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg">
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{sol.empleadoNombre}</p>
                                                                    <p className="text-[9px] text-slate-400">No respondió en el plazo: no se generó turno, contrato ni alta. Se puede volver a convocar.</p>
                                                                    <EventualEstadoLinea sol={sol} />
                                                                </div>
                                                                <EstadoSolicitudChip sol={sol} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                            Seleccioná un servicio
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
