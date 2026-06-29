import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { Timestamp, getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = () => getFirestore();

// ── INTERFACES ───────────────────────────────────────────────────────────────

export interface RunEquilibrarCronoInput {
    empresaId: string;
    objectiveId: string;
    year: number;   // ej. 2026
    month: number;  // 1–12
    /** Si true, calcula cambios pero NO los escribe en Firestore. */
    dryRun?: boolean;
    /** positionName values que no participan en la rotación. */
    puestosExentos?: string[];
}

/** Un cambio propuesto por Equilibrar en formato listo para pendingChanges del front. */
export interface EquilibrarProposedChange {
    empId: string;
    dateStr: string;        // YYYY-MM-DD en zona AR
    positionName: string;
    code: string;
    name: string;
    hours: number;
    startTimeStr: string;   // "HH:MM" en hora local AR
    endTimeStr: string;     // "HH:MM" en hora local AR
}

export interface RunEquilibrarCronoOutput {
    ok: boolean;
    empleadosRotados: number;
    bloquesProcesados: number;
    turnosActualizados: number;
    horasAntes: Record<string, number>;   // empId → hs antes
    horasDespues: Record<string, number>; // empId → hs después
    errores: string[];
    dryRun?: boolean;
    /** Lista de cambios propuestos en formato pendingChanges para el front */
    proposedChanges?: EquilibrarProposedChange[];
    /** dryRun=true: indica si el plan estaba publicado al momento del preview */
    isPublished?: boolean;
    /** dryRun=false: indica si el plan fue movido a BORRADOR al aplicar los cambios */
    wasPublished?: boolean;
    /** Puestos encontrados en el período — permite al front mostrar checkboxes de exclusión */
    puestosEncontrados?: string[];
}

// ── TIPOS INTERNOS ───────────────────────────────────────────────────────────

interface TurnoRow {
    id: string;
    empId: string;
    empName: string;
    dateStr: string;        // YYYY-MM-DD en hora AR
    posName: string;
    code: string;
    hours: number;
    name: string;
    startTime: Timestamp;
    endTime: Timestamp;
    isFranco: boolean;
    isAbsence: boolean;
    isDraft: boolean;
}

interface PosProfile {
    posName: string;
    code: string;
    hours: number;
    name: string;
    startUTCHour: number;
    endUTCHour: number;
    endNextDay: boolean;
}

interface Block {
    empId: string;
    empName: string;
    startDate: string;
    shifts: TurnoRow[];   // solo turnos de trabajo del bloque
    /** "${posName}__${code}" del primer turno. Vacío si el bloque es mixto. */
    slotKey: string;
    /** true cuando todos los turnos del bloque tienen el mismo (posName, code). */
    isPure: boolean;
}

// ── UTILIDADES ───────────────────────────────────────────────────────────────

const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const ABSENCE_CODES = new Set(['V', 'L', 'E', 'A', 'AA', 'PG']);

function isOperacional(d: FirebaseFirestore.DocumentData): boolean {
    return d.origin === 'RETEN' || d.origin === 'OPERATIONS_COVERAGE'
        || d.origin === 'SLA_VIRTUAL' || !!d.isReten || d.resolvedBy === 'OPERACIONES';
}

/** Convierte un Timestamp a YYYY-MM-DD en zona AR (UTC-3). */
function tsToDateStrAR(ts: Timestamp): string {
    const ms = ts.toMillis() - 3 * 60 * 60 * 1000;
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

/** Límites amplios del mes para query Firestore: ±1 día de margen para cubrir cualquier TZ. */
function monthBoundsAR(year: number, month: number) {
    const m = month - 1;
    return {
        // Empezamos un día antes (por si algún turno fue guardado en UTC u otro TZ)
        start: Timestamp.fromDate(new Date(Date.UTC(year, m, 1, 0, 0, 0))),
        // Terminamos un día después
        end:   Timestamp.fromDate(new Date(Date.UTC(year, m + 1, 2, 23, 59, 59))),
    };
}

/**
 * Reconstruye los Timestamps de inicio/fin del turno para una fecha dada,
 * usando el perfil de horario de la posición (derivado de turnos existentes).
 */
function rebuildTs(dateStr: string, prof: PosProfile) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const startDate = new Date(Date.UTC(y, m - 1, d, prof.startUTCHour, 0, 0));
    const endDayOffset = prof.endNextDay ? d + 1 : d;
    const endDate   = new Date(Date.UTC(y, m - 1, endDayOffset, prof.endUTCHour, 0, 0));
    return {
        startTime: Timestamp.fromDate(startDate),
        endTime:   Timestamp.fromDate(endDate),
    };
}

// ── HANDLER PRINCIPAL ────────────────────────────────────────────────────────

const RUNTIME = { timeoutSeconds: 180, memory: '512MB' as const };

export const runEquilibrarCronoHandler = async (
    data: RunEquilibrarCronoInput,
    context: functions.https.CallableContext,
): Promise<RunEquilibrarCronoOutput> => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Se requiere autenticación.');
    }

    const { empresaId, objectiveId, year, month, dryRun = false } = data;
    if (!empresaId || !objectiveId || !year || !month || month < 1 || month > 12) {
        throw new functions.https.HttpsError('invalid-argument', 'empresaId, objectiveId, year y month (1–12) son requeridos.');
    }

    try {

    const errores: string[] = [];

    // ── 1. CARGAR TURNOS DEL MES ─────────────────────────────────────────────
    // Intentamos con rango de fecha (índice compuesto). Si el emulador no tiene
    // el índice activo, reintentamos solo con objectiveId y filtramos en memoria.
    const bounds = monthBoundsAR(year, month);
    let snap: FirebaseFirestore.QuerySnapshot;
    try {
        snap = await db().collection('turnos')
            .where('objectiveId', '==', objectiveId)
            .where('startTime', '>=', bounds.start)
            .where('startTime', '<=', bounds.end)
            .get();
    } catch (_queryErr) {
        snap = await db().collection('turnos')
            .where('objectiveId', '==', objectiveId)
            .get();
    }

    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const allTurnos: TurnoRow[] = [];
    let skippedOps = 0, skippedNoTs = 0, skippedOtherMonth = 0;

    for (const doc of snap.docs) {
        const d = doc.data();
        if (isOperacional(d)) { skippedOps++; continue; }
        if (!d.startTime || !d.endTime) { skippedNoTs++; continue; }
        const code = String(d.code || '').toUpperCase();
        const isFranco  = d.isFranco === true || FRANCO_CODES.has(code);
        const isAbsence = ABSENCE_CODES.has(code);
        const dateStr = tsToDateStrAR(d.startTime as Timestamp);
        // Filtro en memoria por mes/año: cubre cualquier offset de TZ en los datos guardados
        if (!dateStr.startsWith(monthPrefix)) { skippedOtherMonth++; continue; }
        allTurnos.push({
            id: doc.id,
            empId:    String(d.employeeId || ''),
            empName:  String(d.employeeName || d.employeeId || ''),
            dateStr,
            posName:  String(d.positionName || ''),
            code,
            hours:    (() => {
                let h = Number(d.hours) || 0;
                if (!h) {
                    const diffMs = (d.endTime as Timestamp).toMillis() - (d.startTime as Timestamp).toMillis();
                    if (diffMs > 0 && diffMs <= 24 * 3600000)
                        h = Math.round(diffMs / 3600000 * 2) / 2;
                }
                return h;
            })(),
            name:     String(d.name || code),
            startTime: d.startTime as Timestamp,
            endTime:   d.endTime   as Timestamp,
            isFranco,
            isAbsence,
            isDraft: d.draft === true,
        });
    }

    if (allTurnos.length === 0) {
        const diag = `(query: ${snap.docs.length} docs, ops: ${skippedOps}, sinTs: ${skippedNoTs}, otroMes: ${skippedOtherMonth})`;
        return { ok: false, empleadosRotados: 0, bloquesProcesados: 0, turnosActualizados: 0,
                 horasAntes: {}, horasDespues: {}, errores: [`No se encontraron turnos para este objetivo/mes. ${diag}`] };
    }

    // ── 2. PERFILES DE POSICIÓN ──────────────────────────────────────────────
    // Derivar el perfil típico de cada posición desde los turnos existentes.
    // Se usa el PRIMER turno de trabajo de cada posición como plantilla de horario.
    // Perfiles indexados por "${posName}__${code}" para distinguir bandas dentro
    // del mismo puesto físico (ej: "Puesto1__M" ≠ "Puesto1__N").
    const posProfiles: Record<string, PosProfile> = {};

    for (const t of allTurnos) {
        if (t.isFranco || t.isAbsence || !t.posName) continue;
        const slotKey = `${t.posName}__${t.code}`;
        if (!posProfiles[slotKey]) {
            const startD = t.startTime.toDate();
            const endD   = t.endTime.toDate();
            const endNextDay = endD.getUTCDate() !== startD.getUTCDate()
                            || endD.getUTCMonth() !== startD.getUTCMonth();
            posProfiles[slotKey] = {
                posName: t.posName,
                code:    t.code,
                hours:   t.hours,
                name:    t.name,
                startUTCHour: startD.getUTCHours(),
                endUTCHour:   endD.getUTCHours(),
                endNextDay,
            };
        }
    }

    const slotKeys = Object.keys(posProfiles);
    if (slotKeys.length < 2) {
        return { ok: false, empleadosRotados: 0, bloquesProcesados: 0, turnosActualizados: 0,
                 horasAntes: {}, horasDespues: {}, errores: ['Se necesitan al menos 2 tipos de turno distintos para equilibrar.'] };
    }

    const exentosSet = new Set<string>(data.puestosExentos || []);
    const puestosEncontrados = [...new Set(Object.values(posProfiles).map(p => p.posName))].sort();

    // ── 3. HORAS ANTES ──────────────────────────────────────────────────────
    const horasAntes: Record<string, number> = {};
    for (const t of allTurnos) {
        if (!t.isFranco && !t.isAbsence) {
            horasAntes[t.empId] = (horasAntes[t.empId] || 0) + t.hours;
        }
    }

    // ── 4. DETECTAR BLOQUES POR EMPLEADO ────────────────────────────────────
    // Un bloque = días de trabajo consecutivos (sin franco ni ausencia entre medio).
    const byEmp: Record<string, TurnoRow[]> = {};
    for (const t of allTurnos) {
        if (!byEmp[t.empId]) byEmp[t.empId] = [];
        byEmp[t.empId].push(t);
    }

    const allBlocks: Block[] = [];
    const pushBlock = (empId: string, cur: TurnoRow[]) => {
        if (cur.length === 0) return;
        const slotKey = `${cur[0].posName}__${cur[0].code}`;
        const isPure  = cur.every(s => `${s.posName}__${s.code}` === slotKey);
        allBlocks.push({ empId, empName: cur[0].empName, startDate: cur[0].dateStr, shifts: cur, slotKey, isPure });
    };

    for (const [empId, shifts] of Object.entries(byEmp)) {
        shifts.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
        const work = shifts.filter(s => !s.isFranco && !s.isAbsence && s.posName);
        if (work.length === 0) continue;

        let cur: TurnoRow[] = [work[0]];
        for (let i = 1; i < work.length; i++) {
            const prevMs = new Date(work[i - 1].dateStr + 'T12:00:00Z').getTime();
            const currMs = new Date(work[i    ].dateStr + 'T12:00:00Z').getTime();
            const diffDays = Math.round((currMs - prevMs) / 86400000);
            if (diffDays === 1) {
                cur.push(work[i]);
            } else {
                pushBlock(empId, cur);
                cur = [work[i]];
            }
        }
        pushBlock(empId, cur);
    }

    if (allBlocks.length === 0) {
        return { ok: false, empleadosRotados: 0, bloquesProcesados: 0, turnosActualizados: 0,
                 horasAntes, horasDespues: horasAntes, errores: ['No se detectaron bloques de trabajo.'] };
    }

    // ── 5. ASIGNACIÓN GREEDY POR GRUPO DE RANGO ─────────────────────────────────
    // currentHours arranca desde horasAntes (no desde 0): el greedy sabe de
    // entrada quién ya tiene muchas o pocas horas y asigna los bloques pesados
    // a los empleados con menor carga acumulada real.
    //
    // Restricción N→M: si el bloque anterior del empleado termina a la misma
    // hora UTC que el nuevo empieza (ej. nocturno sale 7am → matutino entra 7am)
    // y no hay ningún día franco de por medio, se saltea ese slot y se prueba
    // el siguiente disponible. Secuencia mínima válida: N → F → M.

    const sortedSlotKeys = slotKeys
        .filter(k => !exentosSet.has(posProfiles[k].posName))
        .sort((a, b) => {
            const hd = posProfiles[b].hours - posProfiles[a].hours;
            return hd !== 0 ? hd : a.localeCompare(b);
        });

    const updates: Map<string, { posName: string; code: string; hours: number; name: string; startTime: Timestamp; endTime: Timestamp }> = new Map();
    const rotadosSet = new Set<string>();
    let bloquesProcesados = 0;

    // Inicializar desde las horas reales del cronograma
    const currentHours: Record<string, number> = { ...horasAntes };

    // Objetivo de equilibrio: promedio de horas del período.
    // Empleados sobre este umbral no recibirán slots más pesados que el original.
    const empIds = Object.keys(horasAntes);
    const targetHours = empIds.length > 0
        ? Math.round(empIds.reduce((s, id) => s + (horasAntes[id] || 0), 0) / empIds.length)
        : 192;

    // Rastreo por empleado para la restricción de transición N→M
    const lastBlockEndDate: Record<string, string> = {};
    const lastAssignedSlotKey: Record<string, string> = {};

    const violaTransicion = (empId: string, candidate: PosProfile, blockFirstDay: string): boolean => {
        const prevKey = lastAssignedSlotKey[empId];
        const prevEnd = lastBlockEndDate[empId];
        if (!prevKey || !prevEnd) return false;
        const prevSlot = posProfiles[prevKey];
        if (!prevSlot) return false;
        // El turno previo termina a la misma hora UTC en que el candidato empieza
        if (prevSlot.endUTCHour !== candidate.startUTCHour) return false;
        // Brecha de días entre último día del bloque anterior y primer día del nuevo
        const gapDays = Math.round(
            (new Date(blockFirstDay + 'T12:00:00Z').getTime()
           - new Date(prevEnd       + 'T12:00:00Z').getTime()) / 86400000
        );
        // Solo es conflicto si no hay ningún franco entre ellos (gap ≤ 1 día)
        return gapDays <= 1;
    };

    // Agrupar bloques por (startDate, endDate)
    const blocksByRange: Record<string, Block[]> = {};
    for (const block of allBlocks) {
        const endDate = block.shifts[block.shifts.length - 1].dateStr;
        const key = `${block.startDate}__${endDate}`;
        if (!blocksByRange[key]) blocksByRange[key] = [];
        blocksByRange[key].push(block);
    }

    for (const rangeKey of Object.keys(blocksByRange).sort()) {
        const group = blocksByRange[rangeKey];

        // Ordenar sin restar la contribución del bloque actual.
        // Clave = max(horasAntes, currentHours): nunca baja de las horas originales.
        // Corrige el bug "subtract-before-sort": con resta, un empleado N12+207h
        // aparecía como 135 (< 184h M → 136) y seguía recibiendo el bloque pesado.
        // Con max-sin-resta: 207 > 184 → el de más horas queda al final y recibe el
        // slot más liviano; a medida que el ligero acumula, su currentHours sube y
        // deja de recibir los pesados (auto-regulación).
        group.sort((a, b) => {
            const ha = Math.max(horasAntes[a.empId] || 0, currentHours[a.empId] || 0);
            const hb = Math.max(horasAntes[b.empId] || 0, currentHours[b.empId] || 0);
            return ha !== hb ? ha - hb : a.empId.localeCompare(b.empId);
        });

        // Pool de slots: solo bloques puros y no exentos
        const groupPool: Record<string, number> = {};
        for (const block of group) {
            if (block.isPure && block.slotKey && !exentosSet.has(posProfiles[block.slotKey]?.posName || ''))
                groupPool[block.slotKey] = (groupPool[block.slotKey] || 0) + 1;
        }

        for (const block of group) {
            const blockEndDate = block.shifts[block.shifts.length - 1].dateStr;

            if (!block.isPure) {
                // Bloque mixto: su contribución ya está en currentHours (no fue restada)
                bloquesProcesados++;
                lastBlockEndDate[block.empId] = blockEndDate;
                lastAssignedSlotKey[block.empId] = block.slotKey || lastAssignedSlotKey[block.empId] || '';
                continue;
            }

            // Bloque exento: conserva posición actual, no participa en la rotación
            if (exentosSet.has(posProfiles[block.slotKey]?.posName || '')) {
                bloquesProcesados++;
                lastBlockEndDate[block.empId] = blockEndDate;
                lastAssignedSlotKey[block.empId] = block.slotKey;
                continue;
            }

            // Elegir el slot más pesado disponible sin violar:
            //  1. restricción N→M sin franco
            //  2. no asignar slot MÁS PESADO a empleados ya sobre el objetivo
            //     (evita que ROMERO(207h) absorba N12 de GOYOCHEA(230h) en el mismo grupo)
            const origProfCheck = posProfiles[block.slotKey];
            const origHCheck = origProfCheck ? block.shifts.length * origProfCheck.hours : 0;
            let assigned: PosProfile | null = null;
            for (const sk of sortedSlotKeys) {
                if ((groupPool[sk] || 0) <= 0) continue;
                const candidate = posProfiles[sk];
                if (violaTransicion(block.empId, candidate, block.startDate)) continue;
                const newH = block.shifts.length * candidate.hours;
                // Empleado sobre objetivo no recibe slot más pesado que el original
                if (newH > origHCheck && (currentHours[block.empId] || 0) > targetHours) continue;
                assigned = candidate;
                groupPool[sk]--;
                break;
            }

            if (!assigned) {
                // No hay slot válido sin violar N→M: mantener original para no romper cobertura
                if ((groupPool[block.slotKey] || 0) > 0) {
                    assigned = posProfiles[block.slotKey]!;
                    groupPool[block.slotKey]--;
                }
            }

            if (!assigned) {
                // Edge case: no hay slot → currentHours ya tiene la contribución orig
                lastBlockEndDate[block.empId] = blockEndDate;
                lastAssignedSlotKey[block.empId] = block.slotKey;
                bloquesProcesados++;
                continue;
            }

            // Diferencial: quitar original, sumar nuevo
            const origProf2 = posProfiles[block.slotKey];
            const origH = origProf2 ? block.shifts.length * origProf2.hours : 0;
            currentHours[block.empId] = (currentHours[block.empId] || 0) - origH + block.shifts.length * assigned.hours;

            const assignedSlotKey = `${assigned.posName}__${assigned.code}`;
            let changed = false;
            for (const shift of block.shifts) {
                if (`${shift.posName}__${shift.code}` !== assignedSlotKey) {
                    const ts = rebuildTs(shift.dateStr, assigned);
                    updates.set(shift.id, {
                        posName:   assigned.posName,
                        code:      assigned.code,
                        hours:     assigned.hours,
                        name:      assigned.name,
                        startTime: ts.startTime,
                        endTime:   ts.endTime,
                    });
                    changed = true;
                }
            }
            if (changed) rotadosSet.add(block.empId);

            lastBlockEndDate[block.empId] = blockEndDate;
            lastAssignedSlotKey[block.empId] = assignedSlotKey;
            bloquesProcesados++;
        }
    }

    // ── 5b. SEGUNDO PASE: ajuste día a día para empleados aún sobre 200h ────────
    // El pase de bloques falla cuando un bloque pesado no tiene ningún compañero
    // con exactamente el mismo rango de fechas. Este pase trabaja shift a shift:
    // busca, en ese día específico, cualquier empleado con turno más liviano y hace
    // el intercambio si no viola N→M y no lleva al candidato sobre 200h.
    const HORA_TOPE = 200;
    const sobreUmbral = Object.keys(currentHours).filter(id => (currentHours[id] || 0) > HORA_TOPE);

    if (sobreUmbral.length > 0) {
        // Índice fecha → turnos de ese día
        const turnosPorFecha: Record<string, TurnoRow[]> = {};
        for (const t of allTurnos) {
            if (t.isFranco || t.isAbsence || !t.posName) continue;
            if (!turnosPorFecha[t.dateStr]) turnosPorFecha[t.dateStr] = [];
            turnosPorFecha[t.dateStr].push(t);
        }

        const getEffectiveProf = (t: TurnoRow): PosProfile | null => {
            const u = updates.get(t.id);
            const sk = u ? `${u.posName}__${u.code}` : `${t.posName}__${t.code}`;
            return posProfiles[sk] || null;
        };

        // Verifica que el turno previo no termine justo cuando empieza el nuevo (N→M)
        const violaDiaAnterior = (empId: string, newProf: PosProfile, dateStr: string): boolean => {
            const prevMs  = new Date(dateStr + 'T12:00:00Z').getTime() - 86400000;
            const prevDate = new Date(prevMs).toISOString().slice(0, 10);
            const prevShift = (turnosPorFecha[prevDate] || []).find(t => t.empId === empId);
            if (!prevShift) return false;
            const prevProf = getEffectiveProf(prevShift);
            return !!prevProf && prevProf.endUTCHour === newProf.startUTCHour;
        };

        // Verifica que el turno siguiente no empiece justo cuando termina el nuevo (N→M forward)
        const violaDiaSiguiente = (empId: string, newProf: PosProfile, dateStr: string): boolean => {
            const nextMs   = new Date(dateStr + 'T12:00:00Z').getTime() + 86400000;
            const nextDate = new Date(nextMs).toISOString().slice(0, 10);
            const nextShift = (turnosPorFecha[nextDate] || []).find(t => t.empId === empId);
            if (!nextShift) return false;
            const nextProf = getEffectiveProf(nextShift);
            return !!nextProf && newProf.endUTCHour === nextProf.startUTCHour;
        };

        for (const empId of sobreUmbral) {
            // Ordenar turnos del empleado del más pesado al más liviano (estado post pase 1)
            const misShifts = allTurnos
                .filter(t => t.empId === empId && !t.isFranco && !t.isAbsence && t.posName)
                .sort((a, b) => (getEffectiveProf(b)?.hours || 0) - (getEffectiveProf(a)?.hours || 0));

            for (const shift of misShifts) {
                if ((currentHours[empId] || 0) <= HORA_TOPE) break;

                const profActual = getEffectiveProf(shift);
                if (!profActual || profActual.hours <= 8) continue; // ya es turno estándar
                if (exentosSet.has(profActual.posName)) continue;   // no tocar posición exenta

                // Candidatos: empleados que ese día tienen un turno más liviano y
                // no superarían 200h al recibir el pesado, respetando N→M en ambas direcciones
                const candidatos = (turnosPorFecha[shift.dateStr] || []).filter(other => {
                    if (other.empId === empId) return false;
                    const profOther = getEffectiveProf(other);
                    if (!profOther || profOther.hours >= profActual.hours) return false;
                    if (exentosSet.has(profOther.posName)) return false; // no quitar de posición exenta
                    const nuevasHrs = (currentHours[other.empId] || 0) - profOther.hours + profActual.hours;
                    if (nuevasHrs > HORA_TOPE) return false;
                    if (violaDiaAnterior(other.empId, profActual, shift.dateStr)) return false;
                    if (violaDiaSiguiente(other.empId, profActual, shift.dateStr)) return false;
                    return true;
                });

                if (candidatos.length === 0) continue;

                // El de menos horas acumuladas toma el turno pesado
                candidatos.sort((a, b) => (currentHours[a.empId] || 0) - (currentHours[b.empId] || 0));
                const comp     = candidatos[0];
                const profComp = getEffectiveProf(comp)!;

                // Verificar N→M para empId al recibir el slot liviano (ambas direcciones)
                if (violaDiaAnterior(empId, profComp, shift.dateStr)) continue;
                if (violaDiaSiguiente(empId, profComp, shift.dateStr)) continue;

                const tsEmp  = rebuildTs(shift.dateStr, profComp);
                const tsComp = rebuildTs(shift.dateStr, profActual);

                updates.set(shift.id, {
                    posName: profComp.posName, code: profComp.code,
                    hours:   profComp.hours,   name: profComp.name,
                    startTime: tsEmp.startTime, endTime: tsEmp.endTime,
                });
                updates.set(comp.id, {
                    posName: profActual.posName, code: profActual.code,
                    hours:   profActual.hours,   name: profActual.name,
                    startTime: tsComp.startTime, endTime: tsComp.endTime,
                });

                currentHours[empId]      = (currentHours[empId]      || 0) - profActual.hours + profComp.hours;
                currentHours[comp.empId] = (currentHours[comp.empId] || 0) - profComp.hours   + profActual.hours;
                rotadosSet.add(empId);
                rotadosSet.add(comp.empId);
            }
        }
    }

    const turnosActualizados = updates.size;

    // ── 6. HORAS DESPUÉS ────────────────────────────────────────────────────
    // currentHours refleja la redistribución de ambos pases
    const horasDespues: Record<string, number> = { ...currentHours };

    // ── 6b. CAMBIOS PROPUESTOS (formato pendingChanges del front) ────────────
    // Convertimos las timestamps UTC a strings "HH:MM" en hora AR (UTC-3)
    // para que handleSaveAll del front pueda crear los turnos correctamente.
    const proposedChanges: EquilibrarProposedChange[] = [];
    for (const [docId, fields] of updates.entries()) {
        const original = allTurnos.find(t => t.id === docId);
        if (!original) continue;
        const toAR = (ms: number) => {
            const d = new Date(ms - 3 * 3600000);
            return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
        };
        proposedChanges.push({
            empId:        original.empId,
            dateStr:      original.dateStr,
            positionName: fields.posName,
            code:         fields.code,
            name:         fields.name,
            hours:        fields.hours,
            startTimeStr: toAR(fields.startTime.toMillis()),
            endTimeStr:   toAR(fields.endTime.toMillis()),
        });
    }

    // ── 7. ESTADO DE PUBLICACIÓN ────────────────────────────────────────────
    // Verificamos si el plan está publicado en planificacion_estados.
    // Lo hacemos SIEMPRE (dry-run y no-dry) para informar al usuario.
    const planDocId       = `${empresaId}_${objectiveId}_${year}_${month}`;
    const planDocIdLegacy = `${objectiveId}_${year}_${month}`;
    const planRef         = db().collection('planificacion_estados').doc(planDocId);
    const planRefLegacy   = db().collection('planificacion_estados').doc(planDocIdLegacy);
    const [planSnap, planSnapLegacy] = await Promise.all([planRef.get(), planRefLegacy.get()]);
    const isPublished = planSnap.exists || planSnapLegacy.exists;

    if (turnosActualizados === 0) {
        return { ok: true, empleadosRotados: 0, bloquesProcesados, turnosActualizados: 0,
                 horasAntes, horasDespues: horasAntes, dryRun, isPublished, proposedChanges: [],
                 puestosEncontrados,
                 errores: ['Las horas ya están equilibradas — no se realizaron cambios.'] };
    }

    // En modo dry-run devolvemos el preview sin escribir en Firestore
    if (dryRun) {
        return {
            ok: true,
            empleadosRotados: rotadosSet.size,
            bloquesProcesados,
            turnosActualizados,
            horasAntes,
            horasDespues,
            errores,
            dryRun: true,
            isPublished,
            proposedChanges,
            puestosEncontrados,
        };
    }

    // ── 8. MODO BORRADOR: despublicar si estaba publicado ───────────────────
    // Si el plan estaba publicado, lo movemos a BORRADOR antes de aplicar cambios.
    if (planSnap.exists)       await planRef.delete();
    if (planSnapLegacy.exists) await planRefLegacy.delete();

    // ── 9. BATCH WRITE (400 ops max por lote) ───────────────────────────────
    const entries = Array.from(updates.entries());
    const BATCH_MAX = 400;
    for (let i = 0; i < entries.length; i += BATCH_MAX) {
        const batch = db().batch();
        for (const [docId, fields] of entries.slice(i, i + BATCH_MAX)) {
            batch.update(db().collection('turnos').doc(docId), {
                positionName: fields.posName,
                code:        fields.code,
                name:        fields.name,
                hours:       fields.hours,
                startTime:   fields.startTime,
                endTime:     fields.endTime,
            });
        }
        await batch.commit();
    }

    // ── 10. HISTORIAL DE ACTIVIDAD ──────────────────────────────────────────
    try {
        await db().collection('audit_logs').add({
            action:     'EQUILIBRAR_CRONOGRAMA',
            module:     'PLANIFICADOR',
            label:      'Equilibrar horas',
            detail:     `${rotadosSet.size} emp. rotados · ${turnosActualizados} turnos actualizados${isPublished ? ' · plan movido a BORRADOR' : ''}`,
            empresaId,
            objectiveId,
            year,
            month,
            actor:      context.auth!.token?.name || context.auth!.token?.email || context.auth!.uid,
            actorUid:   context.auth!.uid,
            actorEmail: context.auth!.token?.email || '',
            actorName:  context.auth!.token?.name  || '',
            timestamp:  FieldValue.serverTimestamp(),
        });
    } catch (_logErr) {
        // No bloquear la respuesta si falla el log
    }

    return {
        ok: true,
        empleadosRotados:   rotadosSet.size,
        bloquesProcesados,
        turnosActualizados,
        horasAntes,
        horasDespues,
        errores,
        proposedChanges,
        wasPublished: isPublished,
        puestosEncontrados,
    };

    } catch (e: any) {
        // Exponer el error real en la respuesta para facilitar diagnóstico
        // en lugar de devolver un genérico INTERNAL
        const msg = (e instanceof functions.https.HttpsError)
            ? (() => { throw e; })()
            : (e?.message || String(e));
        return {
            ok: false, empleadosRotados: 0, bloquesProcesados: 0, turnosActualizados: 0,
            horasAntes: {}, horasDespues: {}, errores: [`Error: ${msg}`],
        };
    }
};

export const runEquilibrarCrono = functions
    .runWith(RUNTIME)
    .https.onCall(runEquilibrarCronoHandler);
