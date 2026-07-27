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

/** Orden de decisión ante V/L/E — fuente única para cerebro, Auto Lab y UI. */
export const ABSENCE_COVERAGE_PRIORITY_STEPS = [
    {
        step: 1,
        key: 'modo8_plantilla',
        label: 'Modo 8 — plantilla objetivo',
        detail: 'M+T+N con guardias del objetivo (sin extensión 12h).',
        auto: true,
        extraCost: false,
    },
    {
        step: 2,
        key: 'ret_externo_modo8',
        label: 'RET externo + Modo 8',
        detail: 'Un RET de otro objetivo cubre la banda faltante (8h). Sin contingencia D12/N12.',
        auto: true,
        extraCost: false,
    },
    {
        step: 3,
        key: 'ret_interno_excedente',
        label: 'RET stand-by del excedente (Modo 8)',
        detail: 'Si hay guardias de más vs plantilla: cubren el turno del ausente (M/T/N) sin entrar a la rotación ni pasar a 12h.',
        auto: true,
        extraCost: false,
    },
    {
        step: 4,
        key: 'extension_12h',
        label: 'Extensión 12h / contingencia',
        detail: 'D12+N12 solo si no alcanza plantilla + RET stand-by + RET externo. Tope 56h/sem y 200h/mes.',
        auto: true,
        extraCost: false,
    },
    {
        step: 5,
        key: 'ret_externo_modo8',
        label: 'RET externo + Modo 8',
        detail: 'Un RET de otro objetivo cubre la banda faltante (8h). Sin contingencia D12/N12.',
        auto: true,
        extraCost: false,
    },
    {
        step: 6,
        key: 'ret_interno',
        label: 'RET / libre del objetivo (titular)',
        detail: 'Titular en stand-by ese día en la misma dotación.',
        auto: true,
        extraCost: false,
    },
    {
        step: 7,
        key: 'ft',
        label: 'Franco trabajado (FT)',
        detail: 'Último recurso: persona en F ese día. Solo manual — costo doble CCT. Nunca automático.',
        auto: false,
        extraCost: true,
    },
] as const;

export const ABSENCE_COVERAGE_PRIORITY_SUMMARY =
    '① Modo 8 plantilla → ② RET externo + Modo 8 (8h) → ③ RET stand-by excedente cubre ausente (sin rotación) '
    + '→ ④ Extensión 12h solo si no alcanza → ⑤ FT manual (último recurso, costo doble)';

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
            ABSENCE_COVERAGE_PRIORITY_SUMMARY,
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
            'Último recurso tras agotar extensión 12h y RET: asignar turno a quien estaba en F/FF. '
            + 'Solo manual en la grilla — costo doble CCT (franco + jornada). El Auto nunca convierte F→turno solo.',
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

/**
 * Si hay excedente vs plantilla, no activar Modo 12 mientras las ausencias V/L/E
 * del día no superen la cantidad de RET stand-by disponibles.
 */
export function filterModo12DaysWhenSurplusRetAvailable(params: {
    modo12DaysAuto: string[];
    absences: V2AbsenceMap;
    employeeIds: string[];
    plantillaTotal: number;
    peopleAvailable: number;
}): { modo12Days: string[]; messages: string[] } {
    const {
        modo12DaysAuto,
        absences,
        employeeIds,
        plantillaTotal,
        peopleAvailable,
    } = params;
    const messages: string[] = [];
    const surplus = Math.max(0, peopleAvailable - plantillaTotal);

    if (surplus <= 0 || modo12DaysAuto.length === 0) {
        return { modo12Days: modo12DaysAuto, messages };
    }

    const filtered = modo12DaysAuto.filter((dateStr) => {
        const absentVle = countAbsenceOnDate(
            absences,
            employeeIds,
            dateStr,
            MODO12_ABSENCE_CODES,
        );
        return absentVle > surplus;
    });

    const skipped = modo12DaysAuto.length - filtered.length;
    if (skipped > 0) {
        messages.push(
            `Excedente ${surplus} guardia(s) vs plantilla ${plantillaTotal}: `
            + `${skipped} día(s) con V/L/E se cubren con RET stand-by en Modo 8 (M/T/N), sin extensión 12h.`,
        );
    }

    return { modo12Days: filtered, messages };
}

/**
 * Crédito de horas-oferta cuando hay V/L/E en días Modo 12.
 * Cada ausencia resta ~8h del cupo del ausente; en Modo 12 el SLA cierra con
 * D12+N12 (2 personas) en lugar de M+T+N (3), así que ese día no exige la
 * jornada del ausente en el balance agregado del equipo.
 */
export function computeModo12AbsenceOfferCredit(params: {
    absences: V2AbsenceMap;
    employeeIds: string[];
    monthDateStrs: string[];
    modo12Days?: string[];
    avgShiftHours?: number;
}): number {
    const {
        absences,
        employeeIds,
        monthDateStrs,
        avgShiftHours = 8,
    } = params;
    const modo12Set = new Set(params.modo12Days ?? []);
    if (modo12Set.size === 0) {
        for (const empId of employeeIds) {
            const map = absences[empId];
            if (!map) continue;
            map.forEach((code, dateStr) => {
                if (!monthDateStrs.includes(dateStr)) return;
                if (MODO12_ABSENCE_CODES.has(String(code || '').toUpperCase())) {
                    modo12Set.add(dateStr);
                }
            });
        }
    }
    if (modo12Set.size === 0) return 0;

    let credit = 0;
    for (const empId of employeeIds) {
        const map = absences[empId];
        if (!map) continue;
        for (const [dateStr, code] of map.entries()) {
            if (!monthDateStrs.includes(dateStr)) continue;
            if (!MODO12_ABSENCE_CODES.has(String(code || '').toUpperCase())) continue;
            if (!modo12Set.has(dateStr)) continue;
            credit += avgShiftHours;
        }
    }
    return credit;
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
