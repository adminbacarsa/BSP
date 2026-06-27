import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

const db = () => admin.firestore();

// ── INTERFACES ───────────────────────────────────────────────────────────────

export interface RunEquilibrarCronoInput {
    empresaId: string;
    objectiveId: string;
    year: number;   // ej. 2026
    month: number;  // 1–12
}

export interface RunEquilibrarCronoOutput {
    ok: boolean;
    empleadosRotados: number;
    bloquesProcesados: number;
    turnosActualizados: number;
    horasAntes: Record<string, number>;   // empId → hs antes
    horasDespues: Record<string, number>; // empId → hs después
    errores: string[];
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
    startTime: admin.firestore.Timestamp;
    endTime: admin.firestore.Timestamp;
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
}

// ── UTILIDADES ───────────────────────────────────────────────────────────────

const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const ABSENCE_CODES = new Set(['V', 'L', 'E', 'A', 'AA', 'PG']);

function isOperacional(d: FirebaseFirestore.DocumentData): boolean {
    return d.origin === 'RETEN' || d.origin === 'OPERATIONS_COVERAGE'
        || d.origin === 'SLA_VIRTUAL' || !!d.isReten || d.resolvedBy === 'OPERACIONES';
}

/** Convierte un Timestamp a YYYY-MM-DD en zona AR (UTC-3). */
function tsToDateStrAR(ts: admin.firestore.Timestamp): string {
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
        start: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(year, m, 1, 0, 0, 0))),
        // Terminamos un día después
        end:   admin.firestore.Timestamp.fromDate(new Date(Date.UTC(year, m + 1, 2, 23, 59, 59))),
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
        startTime: admin.firestore.Timestamp.fromDate(startDate),
        endTime:   admin.firestore.Timestamp.fromDate(endDate),
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

    const { empresaId, objectiveId, year, month } = data;
    if (!empresaId || !objectiveId || !year || !month || month < 1 || month > 12) {
        throw new functions.https.HttpsError('invalid-argument', 'empresaId, objectiveId, year y month (1–12) son requeridos.');
    }

    const errores: string[] = [];

    // ── 1. CARGAR TURNOS DEL MES ─────────────────────────────────────────────
    // Solo filtramos por objectiveId (índice simple, funciona en emulador y prod).
    // El rango de fecha lo hacemos en memoria con monthPrefix para evitar depender
    // del índice compuesto (objectiveId, startTime) que el emulador no siempre carga.
    const bounds = monthBoundsAR(year, month);
    const snap = await db().collection('turnos')
        .where('objectiveId', '==', objectiveId)
        .where('startTime', '>=', bounds.start)
        .where('startTime', '<=', bounds.end)
        .get().catch(async () => {
            // Fallback sin filtro de fecha: necesario cuando el emulador no tiene
            // el índice compuesto (objectiveId, startTime) activo.
            return db().collection('turnos')
                .where('objectiveId', '==', objectiveId)
                .get();
        });

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
        const dateStr = tsToDateStrAR(d.startTime as admin.firestore.Timestamp);
        // Filtro en memoria por mes/año: cubre cualquier offset de TZ en los datos guardados
        if (!dateStr.startsWith(monthPrefix)) { skippedOtherMonth++; continue; }
        allTurnos.push({
            id: doc.id,
            empId:    String(d.employeeId || ''),
            empName:  String(d.employeeName || d.employeeId || ''),
            dateStr,
            posName:  String(d.positionName || ''),
            code,
            hours:    Number(d.hours) || 0,
            name:     String(d.name || code),
            startTime: d.startTime as admin.firestore.Timestamp,
            endTime:   d.endTime   as admin.firestore.Timestamp,
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
    const posProfiles: Record<string, PosProfile> = {};
    const posQtyByDay: Record<string, Record<string, Set<string>>> = {};

    for (const t of allTurnos) {
        if (t.isFranco || t.isAbsence || !t.posName) continue;

        if (!posProfiles[t.posName]) {
            const startD = t.startTime.toDate();
            const endD   = t.endTime.toDate();
            const endNextDay = endD.getUTCDate() !== startD.getUTCDate()
                            || endD.getUTCMonth() !== startD.getUTCMonth();
            posProfiles[t.posName] = {
                posName: t.posName,
                code:    t.code,
                hours:   t.hours,
                name:    t.name,
                startUTCHour: startD.getUTCHours(),
                endUTCHour:   endD.getUTCHours(),
                endNextDay,
            };
        }

        // Calcular qty máximo observado por día
        if (!posQtyByDay[t.posName]) posQtyByDay[t.posName] = {};
        if (!posQtyByDay[t.posName][t.dateStr]) posQtyByDay[t.posName][t.dateStr] = new Set();
        posQtyByDay[t.posName][t.dateStr].add(t.empId);
    }

    const posQty: Record<string, number> = {};
    for (const [posName, byDay] of Object.entries(posQtyByDay)) {
        posQty[posName] = Math.max(...Object.values(byDay).map(s => s.size));
    }

    const positions = Object.values(posProfiles);
    if (positions.length < 2) {
        return { ok: false, empleadosRotados: 0, bloquesProcesados: 0, turnosActualizados: 0,
                 horasAntes: {}, horasDespues: {}, errores: ['Se necesitan al menos 2 posiciones para equilibrar.'] };
    }

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
                allBlocks.push({ empId, empName: cur[0].empName, startDate: cur[0].dateStr, shifts: cur });
                cur = [work[i]];
            }
        }
        allBlocks.push({ empId, empName: cur[0].empName, startDate: cur[0].dateStr, shifts: cur });
    }

    if (allBlocks.length === 0) {
        return { ok: false, empleadosRotados: 0, bloquesProcesados: 0, turnosActualizados: 0,
                 horasAntes, horasDespues: horasAntes, errores: ['No se detectaron bloques de trabajo.'] };
    }

    // ── 5. ASIGNACIÓN GREEDY GLOBAL ─────────────────────────────────────────
    // Greedy con cola de prioridad: el bloque cuyo empleado tiene MENOS horas
    // acumuladas hasta ese momento recibe la posición más pesada disponible.
    // Esto garantiza rotación cruzada entre subgrupos distintos del ciclo 6+2.
    //
    // Los "slots" por posición/día se inicializan desde la distribución actual
    // para preservar la cobertura del objetivo (misma cantidad de personas
    // por posición cada día).

    // Slots disponibles: cuántos empleados pueden estar en cada posición por día
    const slotsAvail: Record<string, Record<string, number>> = {};
    for (const t of allTurnos) {
        if (t.isFranco || t.isAbsence || !t.posName) continue;
        if (!slotsAvail[t.posName]) slotsAvail[t.posName] = {};
        slotsAvail[t.posName][t.dateStr] = (slotsAvail[t.posName][t.dateStr] || 0) + 1;
    }

    // Posiciones ordenadas por horas DESC (más pesada primero)
    const sortedPos = [...positions].sort((a, b) => b.hours - a.hours);

    const blockQueue = [...allBlocks];
    const updates: Map<string, { posName: string; code: string; hours: number; name: string; startTime: admin.firestore.Timestamp; endTime: admin.firestore.Timestamp }> = new Map();
    const rotadosSet = new Set<string>();
    let bloquesProcesados = 0;
    // Horas acumuladas por empleado en ESTA pasada (arranca en 0, no en horasAntes)
    const runningHours: Record<string, number> = {};

    while (blockQueue.length > 0) {
        // Seleccionar el bloque del empleado con menos horas acumuladas
        blockQueue.sort((a, b) => {
            const ha = runningHours[a.empId] || 0;
            const hb = runningHours[b.empId] || 0;
            return ha !== hb ? ha - hb : a.startDate.localeCompare(b.startDate);
        });
        const block = blockQueue.shift()!;
        const blockDates = block.shifts.map(s => s.dateStr);

        // Buscar la posición más pesada que tenga slots en TODOS los días del bloque
        let assignedPos: PosProfile | null = null;
        for (const pos of sortedPos) {
            if (blockDates.every(d => (slotsAvail[pos.posName]?.[d] ?? 0) > 0)) {
                assignedPos = pos;
                break;
            }
        }

        // Fallback: si ninguna tiene slots en todos los días, tomar la más liviana disponible
        if (!assignedPos) {
            for (let pi = sortedPos.length - 1; pi >= 0; pi--) {
                if (blockDates.every(d => (slotsAvail[sortedPos[pi].posName]?.[d] ?? 0) > 0)) {
                    assignedPos = sortedPos[pi];
                    break;
                }
            }
        }

        if (!assignedPos) {
            // Sin slots disponibles — preservar posición actual sin consumir slot
            const orig = posProfiles[block.shifts[0]?.posName];
            if (orig) {
                runningHours[block.empId] = (runningHours[block.empId] || 0)
                    + block.shifts.length * orig.hours;
            }
            bloquesProcesados++;
            continue;
        }

        // Consumir slots y registrar cambios
        for (const shift of block.shifts) {
            if (slotsAvail[assignedPos.posName]?.[shift.dateStr] !== undefined)
                slotsAvail[assignedPos.posName][shift.dateStr]--;

            if (shift.posName !== assignedPos.posName) {
                const ts = rebuildTs(shift.dateStr, assignedPos);
                updates.set(shift.id, {
                    posName:   assignedPos.posName,
                    code:      assignedPos.code,
                    hours:     assignedPos.hours,
                    name:      assignedPos.name,
                    startTime: ts.startTime,
                    endTime:   ts.endTime,
                });
                rotadosSet.add(block.empId);
            }
        }

        runningHours[block.empId] = (runningHours[block.empId] || 0)
            + block.shifts.length * assignedPos.hours;
        bloquesProcesados++;
    }

    const turnosActualizados = updates.size;
    if (turnosActualizados === 0) {
        return { ok: true, empleadosRotados: 0, bloquesProcesados, turnosActualizados: 0,
                 horasAntes, horasDespues: horasAntes,
                 errores: ['Las horas ya están equilibradas — no se realizaron cambios.'] };
    }

    // ── 6. BATCH WRITE (500 ops max por lote) ───────────────────────────────
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

    // ── 7. HORAS DESPUÉS ────────────────────────────────────────────────────
    const horasDespues: Record<string, number> = { ...horasAntes };
    for (const [docId, fields] of updates.entries()) {
        const original = allTurnos.find(t => t.id === docId);
        if (original && fields.hours !== undefined) {
            horasDespues[original.empId] = (horasDespues[original.empId] || 0)
                + (fields.hours! - original.hours);
        }
    }

    return {
        ok: true,
        empleadosRotados:   rotadosSet.size,
        bloquesProcesados,
        turnosActualizados,
        horasAntes,
        horasDespues,
        errores,
    };
};

export const runEquilibrarCrono = functions
    .runWith(RUNTIME)
    .https.onCall(runEquilibrarCronoHandler);
