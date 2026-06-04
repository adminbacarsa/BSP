/**
 * Motor de cobertura automática para ausencias conocidas (V/L/E/A/PG/AA).
 * Se ejecuta como post-procesado sobre las asignaciones del motor 6+2 bandas fijas.
 *
 * Prioridad: sin turno (1) → RET libre (2) → FT requerido (3, solo marca, no asigna).
 * ESC y ext.12hs se reservan para flujo manual (operaciones en tiempo real).
 */

import { CYCLE_24_MTN } from './fixedBandFloaterScheduleEngine';
import type { V2Assignment, V2EngineContext } from './autoScheduleEngineV2';

const WORK_BANDS = new Set(['M', 'T', 'N']);
const BILLABLE_CODES = new Set(['M', 'T', 'N', 'D12', 'N12']);
const NON_SHIFT_CODES = new Set(['F', 'FF', 'FP', 'RET', 'V', 'L', 'A', 'E', 'AA', 'PG']);

export type CoverageGap = {
    absentEmpId: string;
    dateStr: string;
    band: string;
    coveredBy: string | null;
    coverageType: 'sin_turno' | 'ret' | 'ft_required' | 'uncovered';
};

export type AbsenceCoverageResult = {
    assignments: V2Assignment[];
    gaps: CoverageGap[];
    coveredCount: number;
    ftRequiredCount: number;
    uncoveredCount: number;
};

/**
 * Aplica cobertura automática de ausencias pre-declaradas sobre el crono generado.
 * Solo actúa en el motor fixedBandFloater (necesita `openingSlotByEmp`).
 *
 * Flujo por cada ausencia:
 *  1. Determina la banda esperada del ausente (CYCLE_24_MTN[opening+di]).
 *  2. Si ya hay un trabajador en esa banda ese día → brecha cubierta por ciclo (sin acción).
 *  3. Si no hay cobertura:
 *     a. Busca empleado "sin turno" (Franco/sin asignación) en el mismo objetivo.
 *     b. Busca RET libre ese día en el mismo objetivo.
 *     c. Si nada → marca como ft_required (aviso al operador).
 */
export function applyAbsenceCoverage(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    openingSlotByEmp: Record<string, number>,
): AbsenceCoverageResult {
    // Índice rápido: empId+dateStr → índice en el array
    const aIdx = new Map<string, number>();
    assignments.forEach((a, i) => aIdx.set(`${a.empId}__${a.dateStr}`, i));

    // Empleados válidos del objetivo (mismos que recibió el motor)
    const objectiveEmpIds = new Set(
        ctx.employees
            .filter(e => !ctx.objectiveId || e.preferredObjectiveId === ctx.objectiveId)
            .map(e => e.id),
    );

    const result = [...assignments];
    const gaps: CoverageGap[] = [];

    for (const [absentEmpId, absentDates] of Object.entries(ctx.absences)) {
        if (!objectiveEmpIds.has(absentEmpId)) continue;
        const opening = openingSlotByEmp[absentEmpId];
        if (opening === undefined) continue; // no es empleado del motor 6+2

        for (const dateStr of absentDates.keys()) {
            const di = ctx.daysInMonth.findIndex(d => ctx.getDateKey(d) === dateStr);
            if (di < 0) continue;

            const neededBand = CYCLE_24_MTN[(opening + di) % 24] as string;
            if (!WORK_BANDS.has(neededBand)) continue; // día de franco del ausente → no hay brecha

            // ¿Ya cubierto por otro trabajador regular en esa banda ese día?
            const alreadyCovered = [...objectiveEmpIds].some(id => {
                if (id === absentEmpId) return false;
                if (ctx.absences[id]?.has(dateStr)) return false;
                const ai = aIdx.get(`${id}__${dateStr}`);
                if (ai === undefined) return false;
                return result[ai].code === neededBand;
            });
            if (alreadyCovered) continue;

            // Candidato 1: sin turno (F, sin asignación, o idle ese día)
            const sinTurnoCandidate = findSinTurno(result, aIdx, objectiveEmpIds, absentEmpId, dateStr, ctx);
            if (sinTurnoCandidate) {
                const ai = aIdx.get(`${sinTurnoCandidate}__${dateStr}`);
                const positionName = guessPosition(ctx, absentEmpId, openingSlotByEmp);
                const meta = shiftMetaForBand(neededBand);
                if (ai !== undefined) {
                    result[ai] = {
                        ...result[ai],
                        positionName,
                        code: neededBand,
                        name: meta.name,
                        hours: meta.hours,
                        startTime: meta.startTime,
                        endTime: meta.endTime,
                        isFranco: false,
                    };
                } else {
                    const newAssignment: V2Assignment = {
                        empId: sinTurnoCandidate,
                        dateStr,
                        positionName,
                        code: neededBand,
                        name: meta.name,
                        hours: meta.hours,
                        startTime: meta.startTime,
                        endTime: meta.endTime,
                    };
                    aIdx.set(`${sinTurnoCandidate}__${dateStr}`, result.length);
                    result.push(newAssignment);
                }
                gaps.push({ absentEmpId, dateStr, band: neededBand, coveredBy: sinTurnoCandidate, coverageType: 'sin_turno' });
                continue;
            }

            // Candidato 2: RET libre ese día
            const retCandidate = findRetFree(result, aIdx, objectiveEmpIds, absentEmpId, dateStr, ctx);
            if (retCandidate) {
                const ai = aIdx.get(`${retCandidate}__${dateStr}`);
                if (ai !== undefined && result[ai].code === 'RET') {
                    const positionName = guessPosition(ctx, absentEmpId, openingSlotByEmp);
                    const meta = shiftMetaForBand(neededBand);
                    result[ai] = {
                        ...result[ai],
                        positionName,
                        code: neededBand,
                        name: meta.name,
                        hours: meta.hours,
                        startTime: meta.startTime,
                        endTime: meta.endTime,
                        isFranco: false,
                    };
                    gaps.push({ absentEmpId, dateStr, band: neededBand, coveredBy: retCandidate, coverageType: 'ret' });
                    continue;
                }
            }

            // Sin candidato viable → FT requerido (solo aviso, no asignamos)
            gaps.push({ absentEmpId, dateStr, band: neededBand, coveredBy: null, coverageType: 'ft_required' });
        }
    }

    const coveredCount = gaps.filter(g => g.coveredBy !== null).length;
    const ftRequiredCount = gaps.filter(g => g.coverageType === 'ft_required').length;
    const uncoveredCount = gaps.filter(g => g.coverageType === 'uncovered').length;

    return { assignments: result, gaps, coveredCount, ftRequiredCount, uncoveredCount };
}

function findSinTurno(
    assignments: V2Assignment[],
    aIdx: Map<string, number>,
    objectiveEmpIds: Set<string>,
    absentEmpId: string,
    dateStr: string,
    ctx: V2EngineContext,
): string | null {
    for (const empId of objectiveEmpIds) {
        if (empId === absentEmpId) continue;
        if (ctx.absences[empId]?.has(dateStr)) continue;
        const ai = aIdx.get(`${empId}__${dateStr}`);
        if (ai === undefined) return empId; // sin asignación ese día → disponible
        const code = assignments[ai].code;
        if (code === 'F' || code === 'FF' || code === 'FP') return empId; // en franco → disponible (candidato FT si se activa)
        // Solo devuelve empleados realmente sin turno o con franco (no RET, no turno activo)
    }
    return null;
}

function findRetFree(
    assignments: V2Assignment[],
    aIdx: Map<string, number>,
    objectiveEmpIds: Set<string>,
    absentEmpId: string,
    dateStr: string,
    ctx: V2EngineContext,
): string | null {
    for (const empId of objectiveEmpIds) {
        if (empId === absentEmpId) continue;
        if (ctx.absences[empId]?.has(dateStr)) continue;
        const ai = aIdx.get(`${empId}__${dateStr}`);
        if (ai !== undefined && assignments[ai].code === 'RET') return empId;
    }
    return null;
}

function guessPosition(ctx: V2EngineContext, absentEmpId: string, openingSlotByEmp: Record<string, number>): string {
    return ctx.defaultPositionByEmp?.[absentEmpId] ?? ctx.positions[0]?.positionName ?? 'General';
}

function shiftMetaForBand(band: string): { name: string; hours: number; startTime: string; endTime?: string } {
    const defaults: Record<string, { name: string; hours: number; startTime: string; endTime: string }> = {
        M:   { name: 'Mañana',  hours: 8,  startTime: '07:00', endTime: '15:00' },
        T:   { name: 'Tarde',   hours: 8,  startTime: '15:00', endTime: '23:00' },
        N:   { name: 'Noche',   hours: 8,  startTime: '23:00', endTime: '07:00' },
        D12: { name: 'Diurno',  hours: 12, startTime: '07:00', endTime: '19:00' },
        N12: { name: 'Nocturno',hours: 12, startTime: '19:00', endTime: '07:00' },
    };
    return defaults[band] ?? defaults.M;
}
