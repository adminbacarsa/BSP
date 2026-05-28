/**
 * Regla SUVICO / CCT 422/05 para código F (franco planificado):
 * - Antes del **primer** F de un bloque de descanso: mínimo **48 h trabajadas** en racha,
 *   equivalente a **6 turnos × 8 h** (M/T/N) **o** **4 turnos × 12 h** (D12/N12).
 * - Máximo **2** celdas F consecutivas por bloque; un 3.er F → RET.
 *
 * Aplica post-generación sobre la grilla (corrige F ilegales sin regenerar todo el mes).
 */
import { addDaysStr, isWorkShift, workStreakStatsBackward } from './restBetweenShifts';
import { SUVICO_POLICY } from './suvicoPolicy';

const PLAIN_FRANCO_CODES = new Set(['F', 'FF']);

export type FrancoGuardAssignment = {
    empId: string;
    dateStr: string;
    code: string;
    name?: string;
    hours: number;
    startTime?: string;
    endTime?: string;
    isFranco?: boolean;
    isReten?: boolean;
    positionName?: string;
};

export type FrancoGuardContext = {
    employees: { id: string }[];
    daysInMonth: Date[];
    getDateKey: (d: Date) => string;
};

export type FrancoStreakStats = { hours: number; workDays: number };

/** 48 h = 6×8 h o 4×12 h (no basta sumar 48 h en menos turnos). */
export function streakQualifiesForFranco(streak: FrancoStreakStats): boolean {
    const hours = streak.hours;
    const workDays = streak.workDays;
    const minH = SUVICO_POLICY.REST.STREAK_HOURS_FOR_LONG_REST;
    if (hours + 1e-6 < minH || workDays <= 0) return false;
    const avg = hours / workDays;
    if (avg >= 10) return workDays >= 4;
    return workDays >= 6;
}

function isPlainFrancoCell(a: FrancoGuardAssignment | undefined | null): boolean {
    if (!a) return false;
    const code = String(a.code ?? '').toUpperCase();
    if (!PLAIN_FRANCO_CODES.has(code)) return false;
    if ((a.hours ?? 0) > 0) return false;
    return true;
}

function convertFrancoToRet(a: FrancoGuardAssignment): void {
    a.code = 'RET';
    a.name = 'Retén';
    a.hours = 0;
    a.startTime = '00:00';
    a.isFranco = false;
    a.isReten = true;
    a.positionName = '';
}

export type EnforceFrancoStreakResult = {
    convertedToRet: number;
    rejectedMissing48h: number;
    rejectedOverTwoConsecutive: number;
};

/**
 * Recorre el mes por empleado y convierte F ilegales a RET.
 * `priorAssignments` = fin del mes anterior (racha al arrancar junio).
 */
export function enforceFrancoStreakRules(args: {
    assignments: FrancoGuardAssignment[];
    ctx: FrancoGuardContext;
    priorAssignments?: FrancoGuardAssignment[];
}): EnforceFrancoStreakResult {
    const { assignments, ctx, priorAssignments = [] } = args;
    const result: EnforceFrancoStreakResult = {
        convertedToRet: 0,
        rejectedMissing48h: 0,
        rejectedOverTwoConsecutive: 0,
    };

    const dayKeys = ctx.daysInMonth.map((d) => ctx.getDateKey(d));

    for (const emp of ctx.employees) {
        const getShift = (eid: string, ds: string): FrancoGuardAssignment | null => {
            if (eid !== emp.id) return null;
            const cur = assignments.find((x) => x.empId === eid && x.dateStr === ds);
            if (cur) return cur;
            return priorAssignments.find((x) => x.empId === eid && x.dateStr === ds) ?? null;
        };

        let consecPlainF = 0;

        for (const dateStr of dayKeys) {
            const a = assignments.find((x) => x.empId === emp.id && x.dateStr === dateStr);
            if (!a) continue;

            if (isWorkShift(a)) {
                consecPlainF = 0;
                continue;
            }

            if (!isPlainFrancoCell(a)) continue;

            let reject = false;

            if (consecPlainF === 0) {
                const dayBefore = addDaysStr(dateStr, -1);
                const streak = workStreakStatsBackward(emp.id, dayBefore, (eid, ds) => {
                    const sh = getShift(eid, ds);
                    if (!sh) return null;
                    return { code: sh.code, hours: sh.hours, startTime: sh.startTime, endTime: sh.endTime };
                });
                if (!streakQualifiesForFranco(streak)) {
                    reject = true;
                    result.rejectedMissing48h++;
                } else {
                    consecPlainF = 1;
                }
            } else {
                consecPlainF += 1;
                if (consecPlainF > 2) {
                    reject = true;
                    result.rejectedOverTwoConsecutive++;
                    consecPlainF = 0;
                }
            }

            if (reject) {
                convertFrancoToRet(a);
                result.convertedToRet++;
            }
        }
    }

    return result;
}
