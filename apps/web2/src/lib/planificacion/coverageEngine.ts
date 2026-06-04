/**
 * Motor de cobertura automática para ausencias conocidas (V/L/E/A/PG/AA).
 * Se ejecuta como post-procesado sobre las asignaciones del motor 6+2 bandas fijas.
 *
 * Prioridad: RET libre (1) → ft_required (2, solo marca — no asigna franco trabajado).
 * "Sin turno" = empleado sin ninguna asignación ese día (prácticamente inexistente en 6+2).
 *
 * La cobertura se activa cuando el total de trabajadores en la banda < qty requerido
 * por el puesto (ej: qty=4 → necesita 4×M, 4×T, 4×N por día).
 */

import { CYCLE_24_MTN } from './fixedBandFloaterScheduleEngine';
import type { V2Assignment, V2EngineContext, V2PositionDef } from './autoScheduleEngineV2';

const WORK_BANDS = new Set(['M', 'T', 'N']);

export type CoverageGap = {
    absentEmpId: string;
    dateStr: string;
    band: string;
    coveredBy: string | null;
    coverageType: 'ret' | 'sin_turno' | 'ft_required' | 'uncovered';
};

export type AbsenceCoverageResult = {
    assignments: V2Assignment[];
    gaps: CoverageGap[];
    coveredCount: number;
    ftRequiredCount: number;
    uncoveredCount: number;
};

function is24hs(pos: V2PositionDef): boolean {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}

/**
 * Aplica cobertura automática de ausencias pre-declaradas sobre el crono generado.
 * Solo actúa en el motor fixedBandFloater (necesita `openingSlotByEmp`).
 *
 * Flujo por cada ausencia:
 *  1. Determina la banda esperada del ausente (CYCLE_24_MTN[opening+di]).
 *  2. Cuenta cuántos trabajadores activos hay en esa banda ese día.
 *  3. Si actual < qty requerido por el puesto → brecha real.
 *  4. Busca: RET libre → si nada → ft_required (aviso).
 */
export function applyAbsenceCoverage(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    openingSlotByEmp: Record<string, number>,
): AbsenceCoverageResult {
    const aIdx = new Map<string, number>();
    assignments.forEach((a, i) => aIdx.set(`${a.empId}__${a.dateStr}`, i));

    // Empleados válidos del objetivo en ctx
    const objectiveEmpIds = new Set(
        ctx.employees
            .filter(e => !ctx.objectiveId || e.preferredObjectiveId === ctx.objectiveId)
            .map(e => e.id),
    );

    // Puesto por empleado (para resolver qty)
    const empToPosition: Record<string, string> = {};
    if (ctx.defaultPositionByEmp) {
        for (const [empId, posName] of Object.entries(ctx.defaultPositionByEmp)) {
            empToPosition[empId] = posName;
        }
    }
    // Para empleados sin puesto explícito, usar la positionName del primer assignment
    for (const a of assignments) {
        if (!empToPosition[a.empId] && a.positionName) {
            empToPosition[a.empId] = a.positionName;
        }
    }

    const result = [...assignments];
    const gaps: CoverageGap[] = [];

    for (const [absentEmpId, absentDates] of Object.entries(ctx.absences)) {
        if (!objectiveEmpIds.has(absentEmpId)) continue;
        const opening = openingSlotByEmp[absentEmpId];
        if (opening === undefined) continue;

        // Puesto y qty del empleado ausente
        const posName = empToPosition[absentEmpId] ?? '';
        const pos = ctx.positions.find(p => p.positionName === posName && is24hs(p));
        const qty = pos ? Math.max(1, Number(pos.qty) || 1) : 1;

        for (const dateStr of absentDates.keys()) {
            const di = ctx.daysInMonth.findIndex(d => ctx.getDateKey(d) === dateStr);
            if (di < 0) continue;

            const neededBand = CYCLE_24_MTN[(opening + di) % 24] as string;
            if (!WORK_BANDS.has(neededBand)) continue; // día franco del ausente → sin brecha

            // Contar trabajadores activos en esa banda ese día (excluyendo al ausente)
            let actualBandCount = 0;
            for (const id of objectiveEmpIds) {
                if (id === absentEmpId) continue;
                if (ctx.absences[id]?.has(dateStr)) continue;
                const ai = aIdx.get(`${id}__${dateStr}`);
                if (ai !== undefined && result[ai].code === neededBand) actualBandCount++;
            }

            // Si ya hay suficientes → patchRetForAbsences ya cubrió o no hacía falta
            if (actualBandCount >= qty) continue;

            // Brecha real: falta (qty - actualBandCount) trabajadores en neededBand

            // Candidato RET libre: floater con RET ese día del mismo objetivo
            const retCandidate = findRetFree(result, aIdx, objectiveEmpIds, absentEmpId, dateStr, ctx);
            if (retCandidate !== null) {
                const ai = aIdx.get(`${retCandidate}__${dateStr}`);
                if (ai !== undefined && result[ai].code === 'RET') {
                    const meta = shiftMetaForBand(neededBand);
                    result[ai] = {
                        ...result[ai],
                        positionName: posName || result[ai].positionName,
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

            // Sin candidato RET → FT requerido (operador debe gestionar manualmente)
            gaps.push({ absentEmpId, dateStr, band: neededBand, coveredBy: null, coverageType: 'ft_required' });
        }
    }

    const coveredCount = gaps.filter(g => g.coveredBy !== null).length;
    const ftRequiredCount = gaps.filter(g => g.coverageType === 'ft_required').length;
    const uncoveredCount = gaps.filter(g => g.coverageType === 'uncovered').length;

    return { assignments: result, gaps, coveredCount, ftRequiredCount, uncoveredCount };
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

function shiftMetaForBand(band: string): { name: string; hours: number; startTime: string; endTime?: string } {
    const defaults: Record<string, { name: string; hours: number; startTime: string; endTime: string }> = {
        M:   { name: 'Mañana',   hours: 8,  startTime: '07:00', endTime: '15:00' },
        T:   { name: 'Tarde',    hours: 8,  startTime: '15:00', endTime: '23:00' },
        N:   { name: 'Noche',    hours: 8,  startTime: '23:00', endTime: '07:00' },
        D12: { name: 'Diurno',   hours: 12, startTime: '07:00', endTime: '19:00' },
        N12: { name: 'Nocturno', hours: 12, startTime: '19:00', endTime: '07:00' },
    };
    return defaults[band] ?? defaults.M;
}
