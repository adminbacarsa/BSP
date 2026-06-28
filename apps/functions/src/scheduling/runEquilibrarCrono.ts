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
    const posProfiles: Record<string, PosProfile> = {};

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

    // ── 5. ASIGNACIÓN GREEDY POR GRUPO DE RANGO ─────────────────────────────────
    // Agrupamos los bloques por (startDate, endDate) exacto. Dentro de cada grupo
    // TODOS los bloques tienen el mismo rango de fechas, por lo que intercambiar
    // posiciones entre ellos nunca crea huecos de cobertura.
    // El contador de horas (runningHours) es GLOBAL: la primera posición pesada de
    // cada grupo va al empleado con menos horas acumuladas hasta ese momento.

    // Posiciones ordenadas por horas DESC (más pesada primero)
    const sortedPos = [...positions].sort((a, b) => b.hours - a.hours);

    const updates: Map<string, { posName: string; code: string; hours: number; name: string; startTime: Timestamp; endTime: Timestamp }> = new Map();
    const rotadosSet = new Set<string>();
    let bloquesProcesados = 0;
    const runningHours: Record<string, number> = {};

    // Agrupar bloques por (startDate, endDate)
    const blocksByRange: Record<string, Block[]> = {};
    for (const block of allBlocks) {
        const endDate = block.shifts[block.shifts.length - 1].dateStr;
        const key = `${block.startDate}__${endDate}`;
        if (!blocksByRange[key]) blocksByRange[key] = [];
        blocksByRange[key].push(block);
    }

    // Procesar grupos en orden cronológico
    for (const key of Object.keys(blocksByRange).sort()) {
        const group = blocksByRange[key];

        // Ordenar empleados del grupo: menos horas acumuladas primero, empId como desempate
        group.sort((a, b) => {
            const ha = runningHours[a.empId] || 0;
            const hb = runningHours[b.empId] || 0;
            return ha !== hb ? ha - hb : a.empId.localeCompare(b.empId);
        });

        // Pool de posiciones del grupo (multiset de posNames)
        const groupPool: Record<string, number> = {};
        for (const block of group) {
            const origPos = block.shifts[0]?.posName;
            if (origPos) groupPool[origPos] = (groupPool[origPos] || 0) + 1;
        }

        for (const block of group) {
            let assigned: PosProfile | null = null;
            for (const pos of sortedPos) {
                if ((groupPool[pos.posName] || 0) > 0) {
                    assigned = pos;
                    groupPool[pos.posName]--;
                    break;
                }
            }

            if (!assigned) {
                const origPos = block.shifts[0]?.posName;
                const orig = origPos ? posProfiles[origPos] : null;
                if (orig) runningHours[block.empId] = (runningHours[block.empId] || 0) + block.shifts.length * orig.hours;
                bloquesProcesados++;
                continue;
            }

            for (const shift of block.shifts) {
                if (shift.posName !== assigned.posName) {
                    const ts = rebuildTs(shift.dateStr, assigned);
                    updates.set(shift.id, {
                        posName:   assigned.posName,
                        code:      assigned.code,
                        hours:     assigned.hours,
                        name:      assigned.name,
                        startTime: ts.startTime,
                        endTime:   ts.endTime,
                    });
                    rotadosSet.add(block.empId);
                }
            }

            runningHours[block.empId] = (runningHours[block.empId] || 0) + block.shifts.length * assigned.hours;
            bloquesProcesados++;
        }
    }

    const turnosActualizados = updates.size;

    // ── 6. HORAS DESPUÉS (siempre, incluso en dry-run) ──────────────────────
    const horasDespues: Record<string, number> = { ...horasAntes };
    for (const [docId, fields] of updates.entries()) {
        const original = allTurnos.find(t => t.id === docId);
        if (original && fields.hours !== undefined) {
            horasDespues[original.empId] = (horasDespues[original.empId] || 0)
                + (fields.hours! - original.hours);
        }
    }

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
