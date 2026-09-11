/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║           RUNAUTOSCHEDULE — Cloud Function COSP v1.0                    ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                          ║
 * ║  Genera automáticamente el cronograma mensual de un objetivo bajo el     ║
 * ║  esquema 6+2 estricto (CCT 422/05).                                      ║
 * ║                                                                          ║
 * ║  VENTAJA RESPECTO A CORRER EL MOTOR EN EL FRONT:                         ║
 * ║  Al vivir en una Cloud Function desplegada, la lógica queda congelada    ║
 * ║  en la versión de deploy. Cambios en el front no afectan el cómputo      ║
 * ║  hasta que se actualice y redeploy esta función explícitamente.           ║
 * ║                                                                          ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  ALGORITMO — VISIÓN GENERAL                                              ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                          ║
 * ║  ENTRADA: objectiveId · year · month · empresaId                        ║
 * ║                                                                          ║
 * ║  1. CARGA FIRESTORE                                                      ║
 * ║     • SLA del objetivo → puestos (qty, bandas, horarios)                 ║
 * ║     • Empleados de la empresa asignados a este objetivo                  ║
 * ║     • Ausencias del mes (colección ausencias)                            ║
 * ║     • Estado planificación: asignaciones de puesto del mes actual        ║
 * ║     • Estado mes anterior: trailing (último turno, días consecutivos)    ║
 * ║                                                                          ║
 * ║  2. DISTRIBUCIÓN A PUESTOS (buildPositionGroups)                         ║
 * ║     Cada empleado va a un puesto según:                                  ║
 * ║     a) Asignación manual (defaultPositionByEmp del mes actual)           ║
 * ║     b) Fill-ratio: se elige el puesto con menor ratio                    ║
 * ║        ratio = empleados_asignados / positionCapacity(puesto)            ║
 * ║                                                                          ║
 * ║     positionCapacity(puesto):                                            ║
 * ║       • 24hs M/T/N  (6+2) → qty × 4  (3 trabajando + 1 franco)          ║
 * ║       • 24hs D12/N12(4+2) → qty × 3  (2 trabajando + 1 franco)          ║
 * ║       • Custom sin M/T/N  (EN 9h, RO 10h, etc.) → qty × 1               ║
 * ║       • Custom 7d con M/T/N → qty × bandas × 2                          ║
 * ║                                                                          ║
 * ║     Resultado: cada puesto tiene su lista de empIds.                     ║
 * ║                                                                          ║
 * ║  3. SUBGRUPOS DE ROTACIÓN (buildSubgroupsFor24hs)                        ║
 * ║     Solo para puestos 24hs (coverageType='24hs').                        ║
 * ║     Cada qty concurrent del puesto forma 1 subgrupo de 4 regulares       ║
 * ║     (+ sobrantes como "flotantes" que cubren ausencias como RET).        ║
 * ║                                                                          ║
 * ║     Ejemplo: Puesto 1 qty=2, 12 empleados →                              ║
 * ║       Subgrupo A: [emp1, emp2, emp3, emp4]                               ║
 * ║       Subgrupo B: [emp5, emp6, emp7, emp8]                               ║
 * ║       Flotantes: emp9, emp10 → repartidos: A=[..., emp9], B=[..., emp10] ║
 * ║                                                                          ║
 * ║  4. OPENING SLOTS (resolveOpeningSlots)                                  ║
 * ║     El ciclo CYCLE_24_MTN (6M+2F+6T+2F+6N+2F = 24 días) se indexa       ║
 * ║     desde 0 a 23. Cada empleado entra en un índice = "opening slot".     ║
 * ║                                                                          ║
 * ║     • Con trailing mes anterior: se infiere desde el último turno        ║
 * ║       (e.g. si cerró en M día 6 de bloque → junio-1 sería día de F).    ║
 * ║     • Sin trailing (cold-start): offsets canónicos 4, 10, 16, 22         ║
 * ║       (banda M día 1, banda T día 1, banda N día 1, franco día 1).       ║
 * ║     • Empleados con banda fija (defaultShiftByEmp='M'): su zona de       ║
 * ║       banda se reserva y los demás se distribuyen en las restantes.      ║
 * ║                                                                          ║
 * ║  5. GENERACIÓN TURNO A TURNO                                             ║
 * ║     Para cada empleado × día:                                            ║
 * ║       código = CYCLE_24_MTN[(opening + dayIndex) % 24]                   ║
 * ║                                                                          ║
 * ║     Casos especiales:                                                    ║
 * ║     • Empleado con banda fija (M/T/N): siempre esa banda en días lab.    ║
 * ║     • Flotante (índice ≥4): código = RET en días laborales               ║
 * ║       (luego convertido a banda real si cubre ausente).                  ║
 * ║     • Puestos no-24hs (EN, RO): turno propio cada día activo, F el resto.║
 * ║                                                                          ║
 * ║  6. PARCHE DE AUSENCIAS (patchRetForAbsences)                            ║
 * ║     Cuando un regular está ausente: se busca un flotante en RET del      ║
 * ║     mismo subgrupo (o de otros) y se convierte a la banda que falta.     ║
 * ║     Orden de búsqueda: flotantes del mismo subgrupo → flotantes cross.   ║
 * ║                                                                          ║
 * ║  7. LIMPIEZA DE RETs RESIDUALES                                          ║
 * ║     Los RET que no convirtió el parche de ausencias se muestran como     ║
 * ║     la banda natural del ciclo (cronograma limpio, sin RETs visibles).   ║
 * ║                                                                          ║
 * ║  8. VERIFICACIÓN DE COBERTURA (verifyCoverage)                           ║
 * ║     Demanda = por cada día × puesto × banda activa: qty requeridas.      ║
 * ║     Oferta  = assignments generados.                                     ║
 * ║     Slot cubierto si assigned ≥ qty. D12≡M, N12≡N para matching.        ║
 * ║     Resultado: totalSlots, coveredSlots, uncoveredSlots, slaHoursClosed. ║
 * ║                                                                          ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  FIRESTORE: COLECCIONES LEÍDAS                                           ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                          ║
 * ║  servicios_sla        → find(objectiveId == input.objectiveId)           ║
 * ║  empleados            → where(empresaId == input.empresaId)              ║
 * ║  ausencias            → where(objectiveId, dateRange del mes)            ║
 * ║  planificacion_estados/{obj}_{year}_{month}   → posiciones del mes       ║
 * ║  planificacion_estados/{obj}_{prevYear}_{prevM} → trailing mes anterior  ║
 * ║                                                                          ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  PARA MODIFICAR ESTE ALGORITMO:                                          ║
 * ║  Editá apps/functions/src/scheduling/autoScheduleEngine.ts               ║
 * ║  (motor) o este archivo (orquestación y Firestore).                      ║
 * ║  Luego: firebase deploy --only functions:runAutoSchedule                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { generateSchedule, verifyCoverage, type EngineContext, type EnginePositionDef, type EngineEmployeeDef } from './autoScheduleEngine';

const db = () => admin.firestore();

// ──────────────────────────────────────────────────────
// TIPOS DE ENTRADA / SALIDA
// ──────────────────────────────────────────────────────

export interface RunAutoScheduleInput {
    objectiveId: string;
    year: number;
    month: number;      // 1-12
    empresaId: string;
    options?: {
        cctCutoffDay?: number;   // día de corte CCT (default 25)
        budgetMode?: 'cct' | 'calendar';
    };
}

export interface RunAutoScheduleOutput {
    ok: boolean;
    error?: string;
    /** Asignaciones generadas — una por empleado × día. */
    assignments: Array<{
        empId: string;
        dateStr: string;
        positionName: string;
        code: string;
        name: string;
        hours: number;
        startTime: string;
        endTime?: string;
        isFranco?: boolean;
    }>;
    stats: {
        totalBillableHours: number;
        targetHours: number;
        slaHoursClosed: boolean;
        slaDeficitRemaining: number;
        employeeMonthlyHours: Record<string, number>;
        idleEmployeeIds: string[];
        positionGroups: Record<string, string[]>;
        openingSlotByEmp: Record<string, number>;
        primaryShiftByEmp: Record<string, string | null>;
    };
    coverage: {
        totalSlots: number;
        coveredSlots: number;
        uncoveredSlots: number;
        coverageRatio: number;
        slaHoursClosed: boolean;
        billableHours: number;
        slaVendidas: number;
        uncoveredByDay: Record<string, Array<{ positionName: string; shiftCode: string; missing: number }>>;
    };
    /** Cuántos empleados necesita por puesto para completar 6+2. */
    staffingNeeds: Array<{
        positionName: string;
        qty: number;
        employeesNeeded: number;
        employeesAssigned: number;
        gap: number;
    }>;
    meta: {
        objectiveId: string;
        year: number;
        month: number;
        employeeCount: number;
        positionCount: number;
        generatedAt: string;
    };
}

// ──────────────────────────────────────────────────────
// LECTURA DE FIRESTORE
// ──────────────────────────────────────────────────────

/** Construye los días del mes como array de Date (UTC noon para evitar TZ issues). */
function buildDaysInMonth(year: number, month: number): Date[] {
    const days: Date[] = [];
    const last = new Date(Date.UTC(year, month, 0)).getDate();
    for (let d = 1; d <= last; d++) {
        days.push(new Date(Date.UTC(year, month - 1, d, 12, 0, 0)));
    }
    return days;
}

function dateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Lee el SLA del objetivo y lo convierte a EnginePositionDef[]. */
async function loadPositionsFromSla(objectiveId: string): Promise<{
    positions: EnginePositionDef[];
    slaVendidas: number;
    codeHoursHint: Record<string, number>;
}> {
    const snap = await db()
        .collection('servicios_sla')
        .where('objectiveId', '==', objectiveId)
        .where('status', '==', 'active')
        .limit(1)
        .get();

    if (snap.empty) throw new functions.https.HttpsError('not-found', `No hay SLA activo para el objetivo ${objectiveId}`);

    const sla = snap.docs[0].data();
    const rawPositions: any[] = sla.positions || [];
    const slaVendidas = Number(sla.totalMonthlyHours || 0);

    const codeHoursHint: Record<string, number> = {};
    const positions: EnginePositionDef[] = rawPositions.map((p: any) => {
        const shifts = (p.allowedShiftTypes || p.shifts || []).map((s: any) => {
            const code = String(s.code || '').toUpperCase();
            const hours = Number(s.hours) || 8;
            if (code && hours > 0) codeHoursHint[code] = hours;
            return { code, name: s.name, hours, startTime: s.startTime, endTime: s.endTime, days: s.days };
        });
        return {
            positionName: String(p.name || p.positionName || ''),
            qty: Number(p.quantity || p.qty) || 1,
            shifts,
            activeDays: p.activeDays,
            coverageType: p.coverageType,
            excludedDates: p.excludedDates,
        };
    });

    return { positions, slaVendidas, codeHoursHint };
}

/** Carga empleados de la empresa asignados (o disponibles para) este objetivo. */
async function loadEmployees(empresaId: string, objectiveId: string): Promise<EngineEmployeeDef[]> {
    const snap = await db()
        .collection('empleados')
        .where('empresaId', '==', empresaId)
        .where('activo', '==', true)
        .get();

    return snap.docs
        .filter(doc => {
            const d = doc.data();
            // Incluir si está asignado al objetivo O si no tiene objetivo preferido
            return !d.preferredObjectiveId || d.preferredObjectiveId === objectiveId;
        })
        .map(doc => ({
            id: doc.id,
            nombre: doc.data().nombre || doc.data().name || doc.id,
        }));
}

/** Carga ausencias del mes como mapa empId → Set<YYYY-MM-DD>. */
async function loadAbsences(
    objectiveId: string,
    empresaId: string,
    year: number,
    month: number,
): Promise<Record<string, Set<string>>> {
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getDate();
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const snap = await db()
        .collection('ausencias')
        .where('empresaId', '==', empresaId)
        .where('startDate', '<=', monthEnd)
        .where('endDate', '>=', monthStart)
        .get();

    const result: Record<string, Set<string>> = {};
    snap.docs.forEach(doc => {
        const d = doc.data();
        const empId = d.employeeId || d.empId;
        if (!empId) return;
        if (!result[empId]) result[empId] = new Set();
        // Marcar cada día de la ausencia dentro del mes
        const start = new Date(d.startDate + 'T12:00:00Z');
        const end = new Date(d.endDate + 'T12:00:00Z');
        for (let cur = new Date(start); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
            const dk = dateKey(cur);
            if (dk >= monthStart && dk <= monthEnd) result[empId].add(dk);
        }
    });

    return result;
}

/** Lee planificacion_estados para obtener asignaciones manuales de puesto y trailing. */
async function loadPlanningState(objectiveId: string, year: number, month: number): Promise<{
    defaultPositionByEmp: Record<string, string>;
    defaultShiftByEmp: Record<string, string>;
    trailingWorkDays?: Record<string, number>;
    trailingRestDays?: Record<string, number>;
    lastShiftByEmp?: Record<string, string>;
    lastWorkBandBeforeRest?: Record<string, string>;
}> {
    const key = `${objectiveId}_${year}_${month}`;
    const snap = await db().collection('planificacion_estados').doc(key).get();
    const d = snap.data() || {};
    return {
        defaultPositionByEmp: d.defaultPositionByEmp || {},
        defaultShiftByEmp: d.defaultShiftByEmp || {},
        trailingWorkDays: d.trailingWorkDays,
        trailingRestDays: d.trailingRestDays,
        lastShiftByEmp: d.lastShiftByEmp,
        lastWorkBandBeforeRest: d.lastWorkBandBeforeRest,
    };
}

// ──────────────────────────────────────────────────────
// CÁLCULO DE DOTACIÓN NECESARIA
// ──────────────────────────────────────────────────────

function BANDS_12H_set() { return new Set(['D12', 'N12']); }
function is24hs(pos: EnginePositionDef) {
    const c = String(pos.coverageType || '').toLowerCase();
    return c === '24hs' || c === '24' || c === '24h';
}

function posCapacity(pos: EnginePositionDef): number {
    const qty = Math.max(1, Number(pos.qty) || 1);
    const sevenDays = !Array.isArray(pos.activeDays) || pos.activeDays.length >= 7;
    const WORK_BANDS = new Set(['M', 'T', 'N']);
    if (is24hs(pos) && sevenDays) {
        const codes = (pos.shifts || []).map(s => String(s.code || '').toUpperCase());
        return qty * (codes.length > 0 && codes.every(c => BANDS_12H_set().has(c)) ? 3 : 4);
    }
    if (sevenDays) {
        const activeBands = (pos.shifts || []).filter(s => WORK_BANDS.has(String(s.code || '').toUpperCase())).length;
        if (activeBands === 0) return qty;
        return qty * Math.max(1, activeBands) * 2;
    }
    return qty;
}

function buildStaffingNeeds(
    positions: EnginePositionDef[],
    positionGroups: Record<string, string[]>,
): RunAutoScheduleOutput['staffingNeeds'] {
    return positions.map(pos => {
        const needed = posCapacity(pos);
        const assigned = (positionGroups[pos.positionName] || []).length;
        return {
            positionName: pos.positionName,
            qty: Number(pos.qty) || 1,
            employeesNeeded: needed,
            employeesAssigned: assigned,
            gap: Math.max(0, needed - assigned),
        };
    });
}

// ──────────────────────────────────────────────────────
// CALLABLE PRINCIPAL
// ──────────────────────────────────────────────────────

const RUNTIME = { timeoutSeconds: 120, memory: '512MB' as const };

/** Lógica de generación sin validación de auth — usable desde otros contexts (ej. agente). */
export async function runAutoScheduleCore(data: RunAutoScheduleInput): Promise<RunAutoScheduleOutput> {
    const { objectiveId, year, month, empresaId, options } = data;

    if (!objectiveId || !year || !month || !empresaId) {
        throw new Error('objectiveId, year, month y empresaId son requeridos.');
    }
    if (month < 1 || month > 12) throw new Error('month debe ser 1-12.');

    const [
        { positions, slaVendidas, codeHoursHint },
        employees,
    ] = await Promise.all([
        loadPositionsFromSla(objectiveId),
        loadEmployees(empresaId, objectiveId),
    ]);

    if (positions.length === 0) throw new Error('El SLA no tiene puestos definidos.');

    const daysInMonth = buildDaysInMonth(year, month);
    const currentState = await loadPlanningState(objectiveId, year, month);

    let defaultPositionByEmp = currentState.defaultPositionByEmp;
    let defaultShiftByEmp = currentState.defaultShiftByEmp;

    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevState = await loadPlanningState(objectiveId, prevYear, prevMonth);

    if (Object.keys(defaultPositionByEmp).length === 0 && Object.keys(prevState.defaultPositionByEmp).length > 0) {
        defaultPositionByEmp = prevState.defaultPositionByEmp;
        defaultShiftByEmp = prevState.defaultShiftByEmp;
    }

    const absencesRaw = await loadAbsences(objectiveId, empresaId, year, month);
    const absences: Record<string, Set<string>> = absencesRaw;

    const ctx: EngineContext = {
        positions,
        employees,
        daysInMonth,
        slaVendidas,
        autoCycles: ['6+2'],
        absences,
        defaultPositionByEmp,
        defaultShiftByEmp,
        prevMonthTrailingWorkDays: prevState.trailingWorkDays,
        prevMonthTrailingRestDays: prevState.trailingRestDays,
        prevMonthLastShiftByEmp: prevState.lastShiftByEmp,
        prevMonthLastWorkBandBeforeRest: prevState.lastWorkBandBeforeRest,
        cctCutoffDay: options?.cctCutoffDay ?? 25,
        codeHoursHint,
    };

    const result = generateSchedule(ctx);
    const coverage = verifyCoverage(ctx, result.assignments);
    const staffingNeeds = buildStaffingNeeds(positions, result.stats.positionGroups);

    return {
        ok: coverage.uncoveredSlots === 0 && coverage.slaHoursClosed,
        assignments: result.assignments,
        stats: result.stats,
        coverage,
        staffingNeeds,
        meta: {
            objectiveId,
            year,
            month,
            employeeCount: employees.length,
            positionCount: positions.length,
            generatedAt: new Date().toISOString(),
        },
    };
}

export const runAutoScheduleHandler = async (
    data: RunAutoScheduleInput,
    context: functions.https.CallableContext,
): Promise<RunAutoScheduleOutput> => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Se requiere autenticación.');
    }
    try {
        return await runAutoScheduleCore(data);
    } catch (e: any) {
        const msg = String(e?.message ?? e ?? 'Error en autoSchedule');
        if (msg.includes('requeridos') || msg.includes('1-12')) {
            throw new functions.https.HttpsError('invalid-argument', msg);
        }
        if (msg.includes('puestos definidos')) {
            throw new functions.https.HttpsError('failed-precondition', msg);
        }
        throw new functions.https.HttpsError('internal', msg);
    }
};

export const runAutoSchedule = functions
    .runWith(RUNTIME)
    .https.onCall(runAutoScheduleHandler);
