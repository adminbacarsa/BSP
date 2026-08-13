/**
 * Cálculo de la liquidación. Espejo 1:1 de las fórmulas que usa la UI en
 * `apps/web2/src/pages/admin/reportes/index.tsx` (modal "Detalle de horas")
 * y `apps/web2/src/hooks/useReportes.ts`.
 *
 * Reglas (CCT 422/05 — SUVICO):
 *   - Hs Reales = Σ rDur de todos los turnos del ciclo, donde rDur viene de
 *     realStartTime/realEndTime (o checkInTime/checkOutTime). Si no hay
 *     fichada, el turno NO suma a Hs Reales y se agrega un warning.
 *   - hoursMode='planned': usa startTime/endTime planificados como horas reales;
 *     no requiere fichada (útil para cálculos previos al cierre del período).
 *   - Hs Teóricas = Σ duración planificada (endTime − startTime). Códigos no
 *     laborales (F, FF, FP, AA, V, L, A, E, PG, RET) suman 0.
 *   - Al 100% (FT) = Σ horas reales de turnos con isFrancoTrabajado o code=FT.
 *   - Diurnas/Nocturnas = sobre horas reales con corte 21:00–06:00.
 *   - Plus Feriado = horas reales en fechas listadas en colección `feriados`.
 *   - Bolsa 200hs = Hs Reales − Al 100% (FT y feriado se pagan aparte).
 *   - Hs Simples = min(Bolsa, 200). Al 50% = max(0, Bolsa − 200).
 *   - Novedades RRHH: cualquier código no mapeado suma a `otrosDias`.
 */
import * as admin from 'firebase-admin';
import type { CycleRange } from './cycle';
import { toTs } from './cycle';

const PAID_LEAVE = new Set(['V', 'L', 'PG', 'E', 'A']);
const TRUE_NON_WORK = new Set(['F', 'FF', 'FP', 'AA', 'FT']);
const ZERO_HOUR_CODES = new Set(['F', 'FF', 'FP', 'V', 'L', 'PG', 'A', 'E', 'AA', 'RET']);
const SHIFT_HOURS_FALLBACK: Record<string, number> = {
    M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, GU: 8, FT: 0,
};

// RRHH novedades — códigos conocidos CCT 422/05.
// Cualquier código no listado suma a `otrosDias` para no perderse silenciosamente.
const RRHH_CODE_MAP: Record<string, keyof Omit<RrhhNovedades, 'otrosDias'>> = {
    V: 'vacacionesDias',
    L: 'licenciaEspecialDias',
    E: 'enfermedadDias',
    A: 'art',
    PG: 'permisoGremialDias',
    AA: 'injustificadaDias',
    RA: 'retiroAnticipadoDias',
};

/** Etiquetas humanas → código (docs RRHH / planificación). */
const RRHH_TYPE_LABEL_TO_CODE: Record<string, string> = {
    VACACIONES: 'V',
    ENFERMEDAD: 'E',
    ART: 'A',
    'LICENCIA ESP.': 'L',
    'LICENCIA ESPECIAL': 'L',
    'PG PERMISO GREMIAL': 'PG',
    'PERMISO GREMIAL': 'PG',
    INJUSTIFICADA: 'AA',
    'RETIRO ANTICIPADO': 'RA',
};

export interface RrhhNovedades {
    vacacionesDias: number;
    enfermedadDias: number;
    art: number;
    licenciaEspecialDias: number;
    permisoGremialDias: number;
    injustificadaDias: number;
    retiroAnticipadoDias: number;
    /** Días de ausencias con códigos no reconocidos (para futura extensibilidad). */
    otrosDias: number;
}

export interface EmployeeLiquidacion {
    employee: {
        id: string;
        dni: string;
        cuil: string | null;
        fileNumber: string | null;
        fullName: string;
        laborAgreement: string | null;
    };
    acumulado: {
        hsTeoricas: number;
        hsReales: number;
        diurnas: number;
        nocturnas: number;
        al50: number;
        al100FT: number;
        plusFeriado: number;
    };
    liquidacion200: {
        bolsa: number;
        hsSimples: number;
        al50: number;
        nota: string;
    };
    pagaAparte: {
        francoTrabajado100: number;
        plusFeriado: number;
    };
    novedadesRRHH: RrhhNovedades;
    turnosCount: number;
    turnosConFichada: number;
    warnings: string[];
}

export interface LiquidacionSnapshot {
    cycleId: string;
    cycleStart: string;
    cycleEnd: string;
    cctVersion: '422/05';
    hoursMode: 'planned' | 'real';
    generatedAt: string;
    lockedAt: string | null;
    empresaId: string;
    items: EmployeeLiquidacion[];
    pagination: { page: number; pageSize: number; total: number };
}

const round = (n: number): number => Math.round(n * 100) / 100;
const fmtCuil = (raw: any): string | null => {
    if (!raw) return null;
    const s = String(raw).replace(/[^0-9]/g, '');
    if (s.length === 11) return `${s.slice(0, 2)}-${s.slice(2, 10)}-${s.slice(10)}`;
    return String(raw);
};

const tsToDate = (val: any): Date | null => {
    if (!val) return null;
    if (val instanceof admin.firestore.Timestamp) return val.toDate();
    if (typeof val.toDate === 'function') return val.toDate();
    if (typeof val.seconds === 'number') return new Date(val.seconds * 1000);
    if (typeof val._seconds === 'number') return new Date(val._seconds * 1000);
    if (typeof val === 'string') {
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
};

const dateKey = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Horas nocturnas entre 21:00 y 06:00 (resolución por minuto). */
const getNightDuration = (start: Date, end: Date): number => {
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
    if (end.getTime() <= start.getTime()) return 0;
    let mins = 0;
    const cur = new Date(start.getTime());
    const endMs = end.getTime();
    let safety = 0;
    while (cur.getTime() < endMs && safety < 2880) {
        const h = cur.getHours();
        if (h >= 21 || h < 6) mins++;
        cur.setMinutes(cur.getMinutes() + 1);
        safety++;
    }
    return mins / 60;
};

const clampStart = (real: Date, plan: Date, tolMin = 5): Date =>
    (real.getTime() - plan.getTime()) / 60000 <= tolMin ? plan : real;
const clampEnd = (real: Date, plan: Date, tolMin = 5): Date =>
    Math.abs((real.getTime() - plan.getTime()) / 60000) <= tolMin ? plan : real;

const overlapsDay = (start: Date, end: Date, dayStr: string): boolean => {
    const [y, m, d] = dayStr.split('-').map(Number);
    const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
    const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
    return start.getTime() <= dayEnd.getTime() && end.getTime() >= dayStart.getTime();
};

/** Lista de fechas YYYY-MM-DD entre start y end (inclusivos), local TZ. */
const datesBetween = (start: Date, end: Date): string[] => {
    const out: string[] = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endNorm = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (cur.getTime() <= endNorm.getTime()) {
        out.push(dateKey(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return out;
};

export interface BuildSnapshotParams {
    cycle: CycleRange;
    empresaId: string;
    clientIdFilter?: string;
    page?: number;
    pageSize?: number;
    /**
     * 'real' (default): usa fichada (realStartTime/realEndTime o checkIn/checkOut).
     *   Turnos sin fichada generan warning y no suman a Hs Reales.
     * 'planned': usa los tiempos planificados (startTime/endTime) como horas reales.
     *   Útil para calcular la liquidación antes de que todos los turnos estén fichados.
     */
    hoursMode?: 'planned' | 'real';
}

export async function buildLiquidacionSnapshot(
    params: BuildSnapshotParams,
): Promise<LiquidacionSnapshot> {
    const db = admin.firestore();
    const { cycle, empresaId } = params;
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(500, Math.max(1, params.pageSize || 100));
    const hoursMode: 'planned' | 'real' = params.hoursMode === 'planned' ? 'planned' : 'real';

    // 1) Empleados de la empresa (para mapear nombres / DNI / CUIL).
    let empQuery: FirebaseFirestore.Query = db.collection('empleados');
    if (empresaId) empQuery = empQuery.where('empresaId', '==', empresaId);
    const empSnap = await empQuery.get();
    const empMap = new Map<string, FirebaseFirestore.DocumentData>();
    empSnap.forEach((d) => empMap.set(d.id, { id: d.id, ...d.data() }));

    // 2) Feriados.
    const holidaysSnap = await db.collection('feriados').get();
    const holidays = new Set<string>();
    holidaysSnap.forEach((d) => {
        const v = d.data()?.date;
        if (typeof v === 'string') holidays.add(v);
    });

    // 3) Turnos del ciclo. Una sola query por startTime range.
    const tStart = toTs(cycle.cycleStart);
    const tEnd = toTs(cycle.cycleEnd);
    const turnosSnap = await db
        .collection('turnos')
        .where('startTime', '>=', tStart)
        .where('startTime', '<=', tEnd)
        .get();

    // 4) Ausencias del ciclo (cualquier ausencia que solape el rango).
    const ausenciasSnap = await db
        .collection('ausencias')
        .where('startDate', '<=', cycle.cycleEndStr)
        .get();

    // Lockedat: lo derivamos de un doc indexado, no de los turnos individuales.
    const lockDoc = await db.collection('payroll_cycles_locks').doc(cycle.cycleId).get();
    const lockedAtRaw = lockDoc.exists ? lockDoc.data()?.lockedAt : null;
    const lockedAt = lockedAtRaw ? tsToDate(lockedAtRaw)?.toISOString() ?? null : null;

    // Agrupar turnos por empleado y armar acumulado.
    type Acc = {
        emp: FirebaseFirestore.DocumentData | null;
        empId: string;
        hsTeoricas: number;
        hsReales: number;
        diurnas: number;
        nocturnas: number;
        al100FT: number;
        plusFeriado: number;
        turnosCount: number;
        turnosConFichada: number;
        warnings: string[];
        rrhh: RrhhNovedades;
    };
    const acc = new Map<string, Acc>();

    const getAcc = (empId: string): Acc => {
        let cur = acc.get(empId);
        if (cur) return cur;
        cur = {
            emp: empMap.get(empId) || null,
            empId,
            hsTeoricas: 0,
            hsReales: 0,
            diurnas: 0,
            nocturnas: 0,
            al100FT: 0,
            plusFeriado: 0,
            turnosCount: 0,
            turnosConFichada: 0,
            warnings: [],
            rrhh: {
                vacacionesDias: 0,
                enfermedadDias: 0,
                art: 0,
                licenciaEspecialDias: 0,
                permisoGremialDias: 0,
                injustificadaDias: 0,
                retiroAnticipadoDias: 0,
                otrosDias: 0,
            },
        };
        acc.set(empId, cur);
        return cur;
    };

    turnosSnap.forEach((doc) => {
        const data = doc.data() as any;
        if (!data) return;
        if (empresaId && data.empresaId && data.empresaId !== empresaId) return;
        if (params.clientIdFilter && data.clientId !== params.clientIdFilter) return;
        if (data.draft === true) return;
        if (data.isUnassigned === true) return;

        const empId = data.employeeId;
        if (!empId || empId === 'VACANTE') return;
        if (empresaId && !empMap.has(empId)) return;

        const code = String(data.code || '').trim().toUpperCase();
        const status = String(data.status || '').toUpperCase();
        if (status === 'CANCELED' || status === 'CANCELLED') return;

        const a = getAcc(empId);
        a.turnosCount++;

        const start = tsToDate(data.startTime);
        const end = tsToDate(data.endTime);
        if (!start || !end) {
            a.warnings.push(`Turno ${doc.id} sin startTime/endTime válidos.`);
            return;
        }

        // Hs Teóricas.
        const isAbsent =
            data.isAbsent === true ||
            status === 'ABSENT' ||
            (status === '' && code === 'AA');
        const isUnjustAbsent = !PAID_LEAVE.has(code) && isAbsent;
        const zeroHours = TRUE_NON_WORK.has(code) || isUnjustAbsent || ZERO_HOUR_CODES.has(code);

        let plannedDur = 0;
        if (!zeroHours) {
            plannedDur = Math.max(0, (end.getTime() - start.getTime()) / 3600000);
            if (plannedDur === 0 || plannedDur > 24 || isNaN(plannedDur)) {
                plannedDur = SHIFT_HOURS_FALLBACK[code] ?? 8;
            }
        }
        a.hsTeoricas += plannedDur;

        if (zeroHours) return;

        // Resolver horas de trabajo según hoursMode.
        let workStart: Date;
        let workEnd: Date;
        let workDur: number;

        if (hoursMode === 'planned') {
            // Usa tiempos planificados directamente — no requiere fichada.
            workStart = start;
            workEnd = end;
            workDur = plannedDur;
        } else {
            // Modo real: requiere fichada.
            const rStartRaw = tsToDate(data.realStartTime) ?? tsToDate(data.checkInTime);
            const rEndRaw = tsToDate(data.realEndTime) ?? tsToDate(data.checkOutTime);
            const rStart = rStartRaw ? clampStart(rStartRaw, start, 5) : null;
            const rEnd = rEndRaw ? clampEnd(rEndRaw, end, 5) : null;
            let rDur: number | null = null;
            if (rStart && rEnd) {
                const rd = (rEnd.getTime() - rStart.getTime()) / 3600000;
                if (rd >= 0 && rd <= 36) rDur = rd;
            }
            if (rDur == null) {
                a.warnings.push(
                    `Turno ${doc.id} (${code} ${dateKey(start)}) sin fichada — no suma a Hs Reales.`,
                );
                return;
            }
            workStart = rStart!;
            workEnd = rEnd!;
            workDur = rDur;
        }

        a.turnosConFichada++;
        a.hsReales += workDur;

        const night = getNightDuration(workStart, workEnd);
        const day = Math.max(0, workDur - night);
        a.diurnas += day;
        a.nocturnas += night;

        const isFT = data.isFrancoTrabajado === true || code === 'FT';
        if (isFT) a.al100FT += workDur;

        if (holidays.has(dateKey(start))) a.plusFeriado += workDur;
    });

    // Ausencias / RRHH novedades — solo se cuentan días aprobados que solapan ciclo.
    ausenciasSnap.forEach((doc) => {
        const data = doc.data() as any;
        if (!data) return;
        if (empresaId && data.empresaId && data.empresaId !== empresaId) return;
        const status = String(data.status || '').toUpperCase();
        if (status !== 'APPROVED' && status !== '') return;

        const empId = data.employeeId;
        if (!empId) return;
        if (empresaId && !empMap.has(empId)) return;

        const startStr: string = String(data.startDate || '');
        const endStr: string = String(data.endDate || startStr);
        if (!startStr) return;
        const start = tsToDate(startStr);
        const end = tsToDate(endStr) || start;
        if (!start || !end) return;

        if (end < cycle.cycleStart || start > cycle.cycleEnd) return;

        const a = getAcc(empId);
        const raw = String(data.absenceType || data.codigo || data.type || '').trim();
        const upper = raw.toUpperCase();
        const code = RRHH_CODE_MAP[upper]
            ? upper
            : (RRHH_TYPE_LABEL_TO_CODE[upper] || upper);

        const allDays = datesBetween(start, end);
        let count = 0;
        for (const dStr of allDays) {
            if (overlapsDay(cycle.cycleStart, cycle.cycleEnd, dStr)) count++;
        }
        if (count <= 0) return;

        const mappedField = RRHH_CODE_MAP[code];
        if (mappedField) {
            (a.rrhh as any)[mappedField] += count;
        } else {
            // Código no reconocido — lo acumulamos en otrosDias para no silenciarlo.
            a.rrhh.otrosDias += count;
        }
    });

    // Armar items finales con bolsa 200hs y paginación.
    const allItems: EmployeeLiquidacion[] = [];
    for (const [empId, a] of acc) {
        const empData = a.emp || {};
        const fullName: string =
            empData.name ||
            (empData.firstName ? `${empData.lastName || ''}, ${empData.firstName}`.trim() : '') ||
            'Sin Nombre';
        const dni = String(empData.dni || '').trim();
        const cuil = fmtCuil(empData.cuil || empData.cuit);
        const fileNumber = empData.fileNumber ? String(empData.fileNumber) : null;
        const laborAgreement = empData.laborAgreement ? String(empData.laborAgreement) : null;

        const bolsa = Math.max(0, a.hsReales - a.al100FT);
        const hsSimples = Math.min(bolsa, 200);
        const al50 = Math.max(0, bolsa - 200);

        allItems.push({
            employee: { id: empId, dni, cuil, fileNumber, fullName, laborAgreement },
            acumulado: {
                hsTeoricas: round(a.hsTeoricas),
                hsReales: round(a.hsReales),
                diurnas: round(a.diurnas),
                nocturnas: round(a.nocturnas),
                al50: round(al50),
                al100FT: round(a.al100FT),
                plusFeriado: round(a.plusFeriado),
            },
            liquidacion200: {
                bolsa: round(bolsa),
                hsSimples: round(hsSimples),
                al50: round(al50),
                nota: 'FT y Feriados se pagan aparte.',
            },
            pagaAparte: {
                francoTrabajado100: round(a.al100FT),
                plusFeriado: round(a.plusFeriado),
            },
            novedadesRRHH: a.rrhh,
            turnosCount: a.turnosCount,
            turnosConFichada: a.turnosConFichada,
            warnings: a.warnings,
        });
    }

    allItems.sort((x, y) => x.employee.fullName.localeCompare(y.employee.fullName));

    const total = allItems.length;
    const start = (page - 1) * pageSize;
    const items = allItems.slice(start, start + pageSize);

    return {
        cycleId: cycle.cycleId,
        cycleStart: cycle.cycleStartStr,
        cycleEnd: cycle.cycleEndStr,
        cctVersion: '422/05',
        hoursMode,
        generatedAt: new Date().toISOString(),
        lockedAt,
        empresaId,
        items,
        pagination: { page, pageSize, total },
    };
}
