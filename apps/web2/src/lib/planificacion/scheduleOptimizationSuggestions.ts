/**
 * Sugerencias de optimización sobre una grilla ya generada (motor V2 + asignaciones).
 * Complementa `verifyScheduleCoverage` con ideas accionables (prioridad RET, KPI cobertura).
 */

import type { V2Assignment, V2EngineContext, V2GenerateStats } from './autoScheduleEngineV2';
import { pickRepresentativeCycle } from './autoScheduleEngineV2';
import { verifyScheduleCoverage, buildAssignmentGetShift } from './coverageVerification';
import { checkRestBetweenShifts, getShiftStartEndAbs, isWorkShift, type AgreementRestConfig } from './restBetweenShifts';
import { SUVICO_POLICY } from './suvicoPolicy';

const FRANCO = new Set(['F', 'FF', 'FP', 'FT']);
const ABS = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);
const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET']);
const SHIFT_HRS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12, EN: 9 };
const DEFAULT_START: Record<string, string> = { M: '06:00', T: '14:00', N: '22:00', D12: '07:00', N12: '19:00', EN: '09:00' };

export type SuggestionSeverity = 'error' | 'warning' | 'info';

export interface ScheduleChangeSuggestion {
    severity: SuggestionSeverity;
    /** Clave estable para filas UI (ej. cover_slot, ret_priority, double_franco, hours_balance). */
    code: string;
    message: string;
    empId?: string;
    dateStr?: string;
    positionName?: string;
    shiftCode?: string;
    /** Orden sugerido de candidatos (más bajo = gastar RET antes). */
    candidateEmpIdsOrdered?: string[];
}

const PURE_FRANCO = new Set(['F', 'FF']);

function billableHoursByEmp(assignments: V2Assignment[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const a of assignments) {
        const c = String(a.code || '').toUpperCase();
        if (!c || NON_BILLABLE.has(c) || ABS.has(c) || !a.positionName) continue;
        const h = Number(a.hours) || SHIFT_HRS[c] || 0;
        if (h <= 0) continue;
        m.set(a.empId, (m.get(a.empId) || 0) + h);
    }
    return m;
}

function makeRestCfg(ctx: V2EngineContext): AgreementRestConfig {
    const { cL } = pickRepresentativeCycle(ctx.autoCycles || []);
    return {
        minRestBetweenShiftsHours: SUVICO_POLICY.REST.DAILY_MIN_HOURS,
        longRestAfterWorkedHours: SUVICO_POLICY.REST.STREAK_HOURS_FOR_LONG_REST,
        minLongRestHours: SUVICO_POLICY.REST.WEEKLY_MIN_REST_AFTER_STREAK_HOURS,
        maxConsecutiveWorkDays: cL,
    };
}

/**
 * Tras ≥2 francos calendario seguidos (F/FF), el descanso real entre el fin del último
 * trabajo previo y el inicio del siguiente trabajo debe cumplir el mínimo post-racha (SUVICO).
 */
function collectDoubleFrancoGaps(
    empId: string,
    dateStrSorted: string[],
    getShift: (eid: string, ds: string) => any | null,
): string[] {
    const msgs: string[] = [];
    let lastWorkEndAbs: Date | null = null;
    let francoRun = 0;

    for (const ds of dateStrSorted) {
        const a = getShift(empId, ds);
        const code = a ? String(a.code || '').toUpperCase() : '';

        if (a && isWorkShift(a)) {
            const se = getShiftStartEndAbs(ds, a);
            if (!se) {
                francoRun = 0;
                continue;
            }
            if (francoRun >= 2 && lastWorkEndAbs) {
                const gapH = (se.start.getTime() - lastWorkEndAbs.getTime()) / 3600000;
                const minLong = SUVICO_POLICY.REST.WEEKLY_MIN_REST_AFTER_STREAK_HOURS;
                if (gapH + 1e-6 < minLong) {
                    msgs.push(
                        `Doble franco (${francoRun}d) con solo ${gapH.toFixed(1)}h entre fin de trabajo previo e inicio del ${ds} — conviene ≥${minLong}h.`,
                    );
                }
            }
            lastWorkEndAbs = se.end;
            francoRun = 0;
            continue;
        }

        if (a && PURE_FRANCO.has(code)) {
            francoRun += 1;
            continue;
        }

        francoRun = 0;
    }
    return msgs;
}

function positionActiveDaysSet(ctx: V2EngineContext, positionName: string): Set<string> | null {
    const pos = ctx.positions.find((p) => p.positionName === positionName);
    const ad = pos?.activeDays;
    if (!ad || ad.length === 0 || ad.length >= 7) return null;
    return new Set(ad);
}

/**
 * Heurística: puesto administrativo (nombre) con días activos L–V: francos en día operativo del puesto → revisar.
 */
function adminFrancoWarnings(ctx: V2EngineContext, assignments: V2Assignment[]): ScheduleChangeSuggestion[] {
    const out: ScheduleChangeSuggestion[] = [];
    const adminRe = /encarg|administraci|oficina/i;
    for (const a of assignments) {
        const c = String(a.code || '').toUpperCase();
        if (!FRANCO.has(c) || !a.positionName) continue;
        if (!adminRe.test(a.positionName)) continue;
        const ds = a.dateStr;
        const letter = ctx.getDayLetter(ds);
        const set = positionActiveDaysSet(ctx, a.positionName);
        if (set && letter && set.has(letter)) {
            out.push({
                severity: 'warning',
                code: 'admin_franco_weekday',
                message: `Puesto "${a.positionName}": ${c} un ${letter} (${ds}). Verificar si el cliente exige cobertura admin ese día.`,
                empId: a.empId,
                dateStr: ds,
                positionName: a.positionName,
                shiftCode: c,
            });
        }
    }
    return out;
}

/**
 * Cobertura agregada por (puesto, fecha): ratio asignados / pedidos (mismo criterio que verificador).
 */
function coverageKpiHints(report: ReturnType<typeof verifyScheduleCoverage>): ScheduleChangeSuggestion[] {
    const out: ScheduleChangeSuggestion[] = [];
    if (report.coverage.coverageRatio >= 0.999) return out;
    out.push({
        severity: 'warning',
        code: 'coverage_kpi',
        message: `Cobertura ${(report.coverage.coverageRatio * 100).toFixed(0)}% (${report.coverage.coveredSlots}/${report.coverage.totalSlots} slots). Priorizar convertir RET de quienes están lejos de ${SUVICO_POLICY.REST.TARGET_MONTHLY}h hasta llenar huecos sin romper ${SUVICO_POLICY.REST.DAILY_MIN_HOURS}h interjornada.`,
    });
    return out;
}

export function buildScheduleOptimizationSuggestions(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
    stats: V2GenerateStats,
): ScheduleChangeSuggestion[] {
    const report = verifyScheduleCoverage(ctx, assignments, stats);
    const hours = billableHoursByEmp(assignments);
    const getShift = buildAssignmentGetShift(assignments, ctx.absences);
    const cfg = makeRestCfg(ctx);

    const dates = ctx.daysInMonth.map((d) => ctx.getDateKey(d)).sort();

    const suggestions: ScheduleChangeSuggestion[] = [];

    suggestions.push(...coverageKpiHints(report));
    suggestions.push(...adminFrancoWarnings(ctx, assignments));

    for (const e of ctx.employees) {
        const bf = collectDoubleFrancoGaps(e.id, dates, getShift);
        for (const msg of bf) {
            suggestions.push({
                severity: 'warning',
                code: 'double_franco_rest',
                message: `${e.nombre || e.id}: ${msg}`,
                empId: e.id,
            });
        }
    }

    for (const u of report.uncovered) {
        const missing = u.qtyRequested - u.qtyAssigned;
        if (missing <= 0) continue;
        const group = (stats.positionGroups?.[u.positionName] || []).slice();
        const ordered = [...group].sort((a, b) => (hours.get(a) || 0) - (hours.get(b) || 0));
        const viable: string[] = [];
        for (const empId of ordered) {
            const code = String(u.shiftCode || '').toUpperCase();
            const st = DEFAULT_START[code] || '07:00';
            const hrs = SHIFT_HRS[code] || 8;
            const ok =
                checkRestBetweenShifts({
                    empId,
                    targetDateStr: u.dateStr,
                    proposed: { code, startTime: st, hours: hrs },
                    getShift,
                    cfg,
                }) === null && !ctx.absences[empId]?.has(u.dateStr);
            const cell = assignments.find((x) => x.empId === empId && x.dateStr === u.dateStr);
            const cc = cell ? String(cell.code || '').toUpperCase() : '';
            if (ok && (cc === 'RET' || FRANCO.has(cc))) viable.push(empId);
            if (viable.length >= 6) break;
        }
        const top = viable.slice(0, 3).map((id) => ctx.employees.find((x) => x.id === id)?.nombre || id).join(', ');
        suggestions.push({
            severity: 'error',
            code: 'cover_slot',
            message: `Hueco ${u.shiftCode} ${u.positionName} ${u.dateStr} (${missing}): priorizar RET de baja carga — candidatos (orden por hs facturables): ${top || `ninguno pasa ${SUVICO_POLICY.REST.DAILY_MIN_HOURS}h/${SUVICO_POLICY.REST.WEEKLY_MIN_REST_AFTER_STREAK_HOURS}h en simulación`}.`,
            dateStr: u.dateStr,
            positionName: u.positionName,
            shiftCode: u.shiftCode,
            candidateEmpIdsOrdered: viable,
        });
    }

    const hi = [...hours.entries()].filter(([, h]) => h >= SUVICO_POLICY.REST.TARGET_MONTHLY).sort((a, b) => b[1] - a[1]);
    for (const [empId, h] of hi.slice(0, 8)) {
        const nom = ctx.employees.find((x) => x.id === empId)?.nombre || empId;
        suggestions.push({
            severity: 'info',
            code: 'hours_soft_cap',
            message: `${nom} lleva ~${Math.round(h)}h facturables este mes: bajar prioridad al cubrir nuevos M/T/N; usar primero RET de compañeros con menos horas.`,
            empId,
        });
    }

    const retLoCap = SUVICO_POLICY.ALERTS.LOW_BILLABLE_HOURS_FOR_RET_PRIORITY;
    const lo = [...hours.entries()].filter(([, h]) => h > 0 && h < retLoCap).sort((a, b) => a[1] - b[1]);
    if (lo.length && report.uncovered.length) {
        const names = lo.slice(0, 5).map(([id]) => ctx.employees.find((x) => x.id === id)?.nombre || id).join(', ');
        suggestions.push({
            severity: 'info',
            code: 'ret_spend_order',
            message: `Para cerrar vendido vs planificado, conviene "gastar" RET primero entre: ${names} (menos de ${retLoCap}h).`,
        });
    }

    return suggestions;
}
