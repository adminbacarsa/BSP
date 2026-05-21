/**
 * Agente de planificación automática COSP — orquestación cliente.
 * Viabilidad/generación/fixer ya viven en planificacion/index.tsx + autoScheduleEngineV3.
 * Este módulo arma PlannerContext, llama optimizePlanningGemini y aplica correcciones.
 */

import type { GeminiCorreccion, GeminiRespuesta, PlannerContext } from '@/services/geminiPlanificacion';
import { optimizarConGemini } from '@/services/geminiPlanificacion';
import type {
    V2Assignment,
    V2EngineContext,
    V2GenerateStats,
} from './autoScheduleEngineV2';
import { effectiveShiftsForPositionDay } from './autoScheduleEngineV2';
import type { CoverageVerificationReport } from './coverageVerification';

const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'V', 'L', 'A', 'E', 'AA', 'PG']);
const SHIFT_HRS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12, EN: 9, RO: 10 };

function maxBillableHoursPerPositionDay(pos: any): number {
    const qty = Math.max(1, Number(pos?.qty) || 1);
    const cov = String(pos?.coverageType || 'custom').toLowerCase();
    if (cov === '24hs' || cov === '24' || cov === '24h') return qty * 24;
    const shiftsArr = Array.isArray(pos?.shifts) ? pos.shifts : [];
    const sumHs = shiftsArr.reduce((acc: number, s: any) => acc + (Number(s.hours) || 8), 0);
    const banda = sumHs > 0 ? sumHs : 8;
    return qty * banda;
}

function billableHours(assignments: V2Assignment[], dateStr: string, positionName: string): number {
    return assignments.reduce((s, a) => {
        if (a.dateStr !== dateStr || a.positionName !== positionName) return s;
        const c = String(a.code || '').toUpperCase();
        if (NON_BILLABLE.has(c)) return s;
        return s + (Number(a.hours) || SHIFT_HRS[c] || 0);
    }, 0);
}

function countRetAvailable(assignments: V2Assignment[], dateStr: string, positionName: string, group: string[]): number {
    return assignments.filter((a) => {
        if (a.dateStr !== dateStr) return false;
        if (!group.includes(a.empId)) return false;
        return String(a.code || '').toUpperCase() === 'RET';
    }).length;
}

export function buildCoberturaPorDia(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
    stats: V2GenerateStats,
): Record<string, Record<string, { actual: number; requerido: number; deficit: number; retDisponibles: number }>> {
    const out: Record<string, Record<string, { actual: number; requerido: number; deficit: number; retDisponibles: number }>> = {};
    const groups = stats.positionGroups || {};

    ctx.daysInMonth.forEach((d) => {
        const dateStr = ctx.getDateKey(d);
        const dayLetter = ctx.getDayLetter(dateStr);
        out[dateStr] = {};
        ctx.positions.forEach((pos) => {
            const posName = pos.positionName;
            const requerido = maxBillableHoursPerPositionDay(pos);
            const active = effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles).length > 0;
            if (!active) {
                out[dateStr][posName] = { actual: 0, requerido: 0, deficit: 0, retDisponibles: 0 };
                return;
            }
            const actual = billableHours(assignments, dateStr, posName);
            const group = groups[posName] || [];
            const retDisponibles = countRetAvailable(assignments, dateStr, posName, group);
            const deficit = Math.max(0, requerido - actual);
            out[dateStr][posName] = { actual, requerido, deficit, retDisponibles };
        });
    });
    return out;
}

export function buildPlanificacionCompleta(
    assignments: V2Assignment[],
): Record<string, Array<{ fecha: string; codigo: string; puesto: string }>> {
    const byEmp: Record<string, Array<{ fecha: string; codigo: string; puesto: string }>> = {};
    assignments.forEach((a) => {
        if (!byEmp[a.empId]) byEmp[a.empId] = [];
        byEmp[a.empId].push({
            fecha: a.dateStr,
            codigo: String(a.code || '').toUpperCase(),
            puesto: a.positionName || 'General',
        });
    });
    return byEmp;
}

export function buildGeminiEmployeesPayload(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
    stats: V2GenerateStats,
): PlannerContext['empleados'] {
    const groups = stats.positionGroups || {};
    const empPos: Record<string, string> = {};
    Object.entries(groups).forEach(([pos, ids]) => {
        (ids || []).forEach((id) => { empPos[id] = pos; });
    });
    const monthly = stats.employeeMonthlyHours || {};
    const values = Object.values(monthly).filter((h) => h > 0);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

    return ctx.employees.map((e) => {
        const puestoAsignado = empPos[e.id] || null;
        const horasMes = monthly[e.id] || 0;
        const priorHoursCiclo = ctx.empMonthlyInitial?.[e.id] || 0;
        const groupIds = puestoAsignado ? groups[puestoAsignado] || [] : [];
        const ownerVirtual = !!puestoAsignado && groupIds.length === 1 && groupIds[0] === e.id;
        const posCfg = puestoAsignado
            ? ctx.positions.find((p) => p.positionName === puestoAsignado)
            : null;
        return {
            id: e.id,
            nombre: e.nombre,
            puestoAsignado,
            defaultPos: puestoAsignado,
            ownerVirtual,
            horasMes,
            priorHoursCiclo,
            diferenciaProm: Math.round((horasMes - avg) * 10) / 10,
            qtyPuesto: posCfg ? Number(posCfg.qty) || 1 : 1,
        };
    });
}

export function buildPlannerContextFromAutoRun(params: {
    mes: string;
    objetivo: string;
    objectiveId: string;
    slaVendidas: number;
    ctx: V2EngineContext;
    assignments: V2Assignment[];
    stats: V2GenerateStats;
    diasBloqueados: string[];
    cicloCCT?: PlannerContext['cicloCCT'];
}): PlannerContext {
    const { ctx, assignments, stats } = params;
    const dias = ctx.daysInMonth.map((d) => ctx.getDateKey(d));
    const absencesObj: Record<string, Record<string, string>> = {};
    Object.entries(ctx.absences || {}).forEach(([empId, map]) => {
        if (!map) return;
        absencesObj[empId] = {};
        map.forEach((code, dateStr) => { absencesObj[empId][dateStr] = code; });
    });

    return {
        mes: params.mes,
        objetivo: params.objetivo,
        slaVendidas: params.slaVendidas,
        puestos: ctx.positions,
        empleados: buildGeminiEmployeesPayload(ctx, assignments, stats),
        dias,
        diasBloqueados: params.diasBloqueados,
        planificacionCompleta: buildPlanificacionCompleta(assignments),
        ausencias: absencesObj,
        coberturaPorDia: buildCoberturaPorDia(ctx, assignments, stats),
        cicloCCT: params.cicloCCT,
        autoCycles: ctx.autoCycles,
    };
}

export function shouldRunGeminiOptimizeStep(
    coverage: CoverageVerificationReport | null,
    opts?: { force?: boolean },
): boolean {
    if (opts?.force) return true;
    if (!coverage) return false;
    if (coverage.coverage.uncoveredSlots > 0) return true;
    if (coverage.restViolations.length > 0) return true;
    if (coverage.hours.slaVendidas > 0 && coverage.hours.billableHoursGenerated < coverage.hours.slaVendidas * 0.98) {
        return true;
    }
    return false;
}

export interface ApplyGeminiCorrectionsResult {
    changes: Record<string, {
        isTemp: boolean;
        employeeId: string;
        objectiveId: string;
        positionName: string;
        code: string;
        name: string;
        hours: number;
        startTime: string;
        endTime?: string;
        isFranco?: boolean;
        isReten?: boolean;
    }>;
    applied: number;
    skipped: number;
}

export function applyGeminiCorrectionsToPendingChanges(
    correcciones: GeminiCorreccion[],
    baseChanges: Record<string, any>,
    params: {
        objectiveId: string;
        assignments: V2Assignment[];
        isDateLocked: (dateStr: string) => boolean;
    },
): ApplyGeminiCorrectionsResult {
    const changes = { ...baseChanges };
    const assignByKey = new Map<string, V2Assignment>();
    params.assignments.forEach((a) => assignByKey.set(`${a.empId}_${a.dateStr}`, a));

    let applied = 0;
    let skipped = 0;
    for (const c of correcciones) {
        const key = `${c.empId}_${c.fecha}`;
        if (params.isDateLocked(c.fecha)) { skipped++; continue; }
        const prev = assignByKey.get(key);
        const code = String(c.codigoNuevo || '').toUpperCase();
        const hours = NON_BILLABLE.has(code) ? 0 : (SHIFT_HRS[code] ?? (prev?.hours || 8));
        changes[key] = {
            isTemp: true,
            employeeId: c.empId,
            objectiveId: params.objectiveId,
            positionName: c.puesto || prev?.positionName || 'General',
            code,
            name: code,
            hours,
            startTime: prev?.startTime || '07:00',
            ...(NON_BILLABLE.has(code) ? { isFranco: code === 'F' || code === 'FF' || code === 'FP' } : {}),
            ...(code === 'RET' ? { isReten: true } : {}),
        };
        applied++;
    }
    return { changes, applied, skipped };
}

export interface PlanningAgentOptimizeResult {
    gemini: GeminiRespuesta;
    applied: number;
    skipped: number;
    blocked: boolean;
    changes: Record<string, any>;
    assignments: V2Assignment[];
}

export function mergeGeminiCorrectionsIntoAssignments(
    assignments: V2Assignment[],
    correcciones: GeminiCorreccion[],
): V2Assignment[] {
    const next = [...assignments];
    const idx = new Map<string, number>();
    next.forEach((a, i) => idx.set(`${a.empId}_${a.dateStr}`, i));
    for (const c of correcciones) {
        const key = `${c.empId}_${c.fecha}`;
        const code = String(c.codigoNuevo || '').toUpperCase();
        const hours = NON_BILLABLE.has(code) ? 0 : (SHIFT_HRS[code] ?? 8);
        const patch: V2Assignment = {
            empId: c.empId,
            dateStr: c.fecha,
            positionName: c.puesto || 'General',
            code,
            name: code,
            hours,
            startTime: '07:00',
            ...(code === 'RET' ? { isReten: true } : {}),
            ...(code === 'F' || code === 'FF' || code === 'FP' ? { isFranco: true } : {}),
        };
        const i = idx.get(key);
        if (i !== undefined) next[i] = { ...next[i], ...patch };
        else {
            idx.set(key, next.length);
            next.push(patch);
        }
    }
    return next;
}

export async function runPlanningAgentOptimizeStep(params: {
    plannerContext: PlannerContext;
    empresaId?: string;
    baseChanges: Record<string, any>;
    objectiveId: string;
    assignments: V2Assignment[];
    isDateLocked: (dateStr: string) => boolean;
}): Promise<PlanningAgentOptimizeResult> {
    const gemini = await optimizarConGemini(params.plannerContext, params.empresaId);
    if (gemini.bloqueoEstructural || !gemini.correcciones?.length) {
        return {
            gemini,
            applied: 0,
            skipped: 0,
            blocked: !!gemini.bloqueoEstructural,
            changes: params.baseChanges,
            assignments: params.assignments,
        };
    }
    const pack = applyGeminiCorrectionsToPendingChanges(
        gemini.correcciones,
        params.baseChanges,
        {
            objectiveId: params.objectiveId,
            assignments: params.assignments,
            isDateLocked: params.isDateLocked,
        },
    );
    const assignments = mergeGeminiCorrectionsIntoAssignments(
        params.assignments,
        gemini.correcciones,
    );
    return {
        gemini,
        applied: pack.applied,
        skipped: pack.skipped,
        blocked: false,
        changes: pack.changes,
        assignments,
    };
}
