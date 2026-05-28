/**
 * Reglas COSP de cobertura — una sola lógica para:
 *  · Modo 8 (6+2 normal)
 *  · Modo 12 por vacaciones / licencias / enfermedad (auto)
 *  · Contingencia manual (liberar RET)
 *  · Franco trabajado (manual, costo extra — nunca Auto silencioso)
 */

import type { V2AbsenceMap } from './autoScheduleEngineV2';

/** Ausencias que activan Modo 12 automático (cubrir con plantilla del objetivo). */
export const MODO12_ABSENCE_CODES = new Set(['V', 'L', 'E']);

export interface StaffingSnapshot {
    cycleKey: string;
    servicioDiarioModo8: number;
    servicioDiarioModo12: number;
    plantillaTotal: number;
}

export type PlanningCoverageModeId =
    | 'modo8'
    | 'modo12_ausencia'
    | 'contingencia'
    | 'franco_trabajado';

export interface PlanningCoverageRule {
    id: PlanningCoverageModeId;
    title: string;
    summary: string;
    /** El motor Auto puede aplicarlo sin intervención humana. */
    autoApplies: boolean;
    /** Implica pago extra / franco trabajado. */
    extraCost: boolean;
}

/** Texto operativo compartido por cerebro Auto y UI del wizard. */
export const PLANNING_COVERAGE_RULES: PlanningCoverageRule[] = [
    {
        id: 'modo8',
        title: 'Modo 8 — 6+2 normal',
        summary: 'M+T+N · plantilla con francos del ciclo (ej. 12 servicio + 4 F = 16). Cobertura 4/4 por puesto.',
        autoApplies: true,
        extraCost: false,
    },
    {
        id: 'modo12_ausencia',
        title: 'Modo 12 — vacaciones / licencias / enfermedad',
        summary:
            'Ese día el SLA pasa a D12+N12. Se cubre con la plantilla del mismo objetivo (reorganizar turnos). '
            + 'No se saca a nadie de franco: eso sería franco trabajado (extra).',
        autoApplies: true,
        extraCost: false,
    },
    {
        id: 'contingencia',
        title: 'Contingencia — apretar día (manual)',
        summary:
            'D12+N12 en fechas elegidas para liberar guardias RET (otro objetivo / evento). '
            + 'El sobrante viene del 12→8 en servicio, no de convertir F en turno.',
        autoApplies: false,
        extraCost: false,
    },
    {
        id: 'franco_trabajado',
        title: 'Franco trabajado — refuerzo',
        summary:
            'Asignar turno a quien estaba en F. Solo manual en la grilla; implica costo extra. '
            + 'El Auto no convierte F→turno para cerrar huecos.',
        autoApplies: false,
        extraCost: true,
    },
];

export function slotsFreedModo12Vs8(staffing: Pick<StaffingSnapshot, 'servicioDiarioModo8' | 'servicioDiarioModo12'>): number {
    return Math.max(0, staffing.servicioDiarioModo8 - staffing.servicioDiarioModo12);
}

export interface Modo12DayCheck {
    dateStr: string;
    ok: boolean;
    absentCount: number;
    absenceModo12Count: number;
    liberables: number;
    reason?: string;
}

function countAbsenceOnDate(
    absences: V2AbsenceMap,
    employeeIds: string[],
    dateStr: string,
    codes?: Set<string>,
): number {
    let n = 0;
    for (const empId of employeeIds) {
        const code = absences[empId]?.get(dateStr);
        if (!code) continue;
        const up = String(code).toUpperCase();
        if (!codes || codes.has(up)) n++;
    }
    return n;
}

function expectedWorkersOnDate(
    peopleAvailable: number,
    workRatio: number,
    absentCount: number,
): number {
    return Math.floor(peopleAvailable * workRatio) - absentCount;
}

/**
 * Valida días con V/L/E: Modo 12 debe poder cubrir con plantilla propia
 * (sin promover F→turno / franco trabajado).
 */
export function validateAbsenceModo12Days(params: {
    staffing: StaffingSnapshot;
    modo12DaysAuto: string[];
    absences: V2AbsenceMap;
    employeeIds: string[];
    peopleAvailable: number;
}): { ok: boolean; checks: Modo12DayCheck[]; messages: string[] } {
    const { staffing, modo12DaysAuto, absences, employeeIds, peopleAvailable } = params;
    const messages: string[] = [];
    const checks: Modo12DayCheck[] = [];

    if (modo12DaysAuto.length === 0) {
        return { ok: true, checks, messages };
    }

    const [cL, cF] = { '4+2': [4, 2], '5+1': [5, 1], '6+1': [6, 1], '6+2': [6, 2] }[staffing.cycleKey] ?? [6, 2];
    const workRatio = cL / (cL + cF);
    const needModo12 = staffing.servicioDiarioModo12;

    for (const dateStr of [...modo12DaysAuto].sort()) {
        const absentCount = countAbsenceOnDate(absences, employeeIds, dateStr);
        const absenceModo12Count = countAbsenceOnDate(absences, employeeIds, dateStr, MODO12_ABSENCE_CODES);
        const expectedWorking = expectedWorkersOnDate(peopleAvailable, workRatio, absentCount);

        let ok = true;
        let reason: string | undefined;

        if (expectedWorking < needModo12) {
            ok = false;
            reason =
                `Plantilla insuficiente (${expectedWorking} disponibles vs ${needModo12} en Modo 12). `
                + 'Sin franco trabajado (extra) no cierra.';
        }

        checks.push({
            dateStr,
            ok,
            absentCount,
            absenceModo12Count,
            liberables: 0,
            reason,
        });

        if (!ok && reason) {
            messages.push(`Ausencias ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}: ${reason}`);
        }
    }

    const allOk = checks.every(c => c.ok);
    if (!allOk) {
        messages.unshift(
            'Modo 12 por ausencias: algunos días no cierran solo con plantilla del objetivo. '
            + 'Revisá licencias/vacaciones o asumí franco trabajado (extra) manual.',
        );
    } else {
        messages.push(
            `${modo12DaysAuto.length} día(s) con V/L/E → Modo 12 (D12+N12) con plantilla del objetivo, sin tocar francos.`,
        );
    }

    return { ok: allOk, checks, messages };
}

/** Contingencia viable solo si hay slack; nunca mezclar con día ya maximizado por ausencias. */
export function validateContingencyCoverage(params: {
    staffing: StaffingSnapshot;
    contingencyDays: string[];
    absences: V2AbsenceMap;
    employeeIds: string[];
    peopleAvailable: number;
    modo12DaysAuto: string[];
}): { ok: boolean; checks: Modo12DayCheck[]; messages: string[] } {
    const {
        staffing,
        contingencyDays,
        absences,
        employeeIds,
        peopleAvailable,
        modo12DaysAuto,
    } = params;

    const messages: string[] = [];
    const checks: Modo12DayCheck[] = [];
    const freedPerDay = slotsFreedModo12Vs8(staffing);

    if (!contingencyDays.length) {
        return { ok: true, checks, messages };
    }

    const autoSet = new Set(modo12DaysAuto);
    const [cL, cF] = { '4+2': [4, 2], '5+1': [5, 1], '6+1': [6, 1], '6+2': [6, 2] }[staffing.cycleKey] ?? [6, 2];
    const workRatio = cL / (cL + cF);
    const needModo8 = staffing.servicioDiarioModo8;

    if (peopleAvailable < staffing.plantillaTotal) {
        messages.push(
            `Contingencia: dotación (${peopleAvailable}) por debajo de plantilla (${staffing.plantillaTotal}).`,
        );
    }

    for (const dateStr of [...contingencyDays].sort()) {
        const absentCount = countAbsenceOnDate(absences, employeeIds, dateStr);
        const expectedWorking = expectedWorkersOnDate(peopleAvailable, workRatio, absentCount);

        let ok = true;
        let reason: string | undefined;
        let liberables = freedPerDay;

        if (absentCount > 0 && autoSet.has(dateStr)) {
            liberables = 0;
            ok = false;
            reason = 'Modo 12 ya activo por ausencias; cobertura maximizada, no hay RET liberables.';
        } else if (expectedWorking < needModo8) {
            liberables = 0;
            ok = false;
            reason = `Sin slack (${expectedWorking} vs ${needModo8} Modo 8). No apretar sin franco trabajado (extra).`;
        } else if (peopleAvailable < staffing.plantillaTotal) {
            liberables = Math.min(liberables, Math.max(0, peopleAvailable - needModo8));
            if (liberables <= 0) {
                ok = false;
                reason = 'Sin plantilla de sobra para liberar RET.';
            }
        }

        checks.push({
            dateStr,
            ok,
            absentCount,
            absenceModo12Count: countAbsenceOnDate(absences, employeeIds, dateStr, MODO12_ABSENCE_CODES),
            liberables,
            reason,
        });

        if (!ok && reason) {
            messages.push(`Contingencia ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}: ${reason}`);
        }
    }

    const ok = checks.every(c => c.ok);
    if (!ok) {
        messages.unshift(
            'Contingencia no viable: quitá fechas o revisá ausencias. No se usa franco→turno (extra).',
        );
    } else if (checks.length > 0) {
        const minLib = Math.min(...checks.map(c => c.liberables));
        messages.push(
            `Contingencia OK: hasta ${minLib} RET/día (D12+N12, sin sacar gente de F).`,
        );
    }

    return { ok, checks, messages };
}
