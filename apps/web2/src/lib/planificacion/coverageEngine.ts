/**
 * Motor de cobertura automática para ausencias conocidas (V/L/E/A/PG/AA).
 * Se ejecuta como post-procesado sobre las asignaciones del motor 6+2 bandas fijas.
 *
 * Prioridad de cobertura:
 *  1. RET libre  → convierte a la banda del ausente
 *  2. F/FF libre → convierte a la banda del ausente (Franco Trabajado)
 *  3. ft_required → sin candidatos disponibles (operador gestiona desde Operaciones)
 *
 * La cobertura se activa cuando el total de trabajadores en la banda < qty requerido
 * por el puesto (ej: qty=2 → necesita 2×N por día).
 */

import { CYCLE_24_MTN } from './fixedBandFloaterScheduleEngine';
import type { V2Assignment, V2EngineContext, V2PositionDef } from './autoScheduleEngineV2';

const WORK_BANDS = new Set(['M', 'T', 'N']);

export type CoverageGap = {
    absentEmpId: string;
    absentName?: string;
    dateStr: string;
    band: string;
    coveredBy: string | null;
    coveredByName?: string;
    /** ret = cubierto por RET auto · ft = cubierto por franco trabajado auto
     *  manual = asignado desde el wizard · ft_required = sin candidatos disponibles
     *  franco_natural = el día de ausencia es franco del ciclo (error en RRHH)
     */
    coverageType: 'ret' | 'ft' | 'sin_turno' | 'ft_required' | 'uncovered' | 'franco_natural' | 'manual';
    ftCandidates?: { empId: string; nombre: string; code: string }[];
};

export type AbsenceCoverageResult = {
    assignments: V2Assignment[];
    gaps: CoverageGap[];
    coveredCount: number;
    ftRequiredCount: number;
    uncoveredCount: number;
    francoNaturalCount: number;
};

function is24hs(pos: V2PositionDef): boolean {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}

/**
 * Aplica cobertura automática de ausencias pre-declaradas sobre el crono generado.
 * Solo actúa en el motor fixedBandFloater (necesita `openingSlotByEmp`).
 */
export function applyAbsenceCoverage(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    openingSlotByEmp: Record<string, number>,
): AbsenceCoverageResult {
    const aIdx = new Map<string, number>();
    assignments.forEach((a, i) => aIdx.set(`${a.empId}__${a.dateStr}`, i));

    const objectiveEmpIds = new Set(
        ctx.employees
            .filter(e => !ctx.objectiveId || e.preferredObjectiveId === ctx.objectiveId)
            .map(e => e.id),
    );

    const empToPosition: Record<string, string> = {};
    if (ctx.defaultPositionByEmp) {
        for (const [empId, posName] of Object.entries(ctx.defaultPositionByEmp)) {
            empToPosition[empId] = posName;
        }
    }
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

        const posName = empToPosition[absentEmpId] ?? '';
        const pos = ctx.positions.find(p => p.positionName === posName && is24hs(p));
        const qty = pos ? Math.max(1, Number(pos.qty) || 1) : 1;

        for (const dateStr of absentDates.keys()) {
            const di = ctx.daysInMonth.findIndex(d => ctx.getDateKey(d) === dateStr);
            if (di < 0) continue;

            const neededBand = CYCLE_24_MTN[(opening + di) % 24] as string;
            if (!WORK_BANDS.has(neededBand)) {
                // Día franco natural del ciclo — la ausencia solapa con un descanso (error en RRHH)
                gaps.push({ absentEmpId, dateStr, band: neededBand, coveredBy: null, coverageType: 'franco_natural' });
                continue;
            }

            // Contar trabajadores activos en esa banda ese día
            let actualBandCount = 0;
            for (const id of objectiveEmpIds) {
                if (id === absentEmpId) continue;
                if (ctx.absences[id]?.has(dateStr)) continue;
                const ai = aIdx.get(`${id}__${dateStr}`);
                if (ai !== undefined && result[ai].code === neededBand) actualBandCount++;
            }

            if (actualBandCount >= qty) continue; // ya cubierto

            // Prioridad 1: RET libre
            const retCandidate = findByCode(result, aIdx, objectiveEmpIds, absentEmpId, dateStr, ctx, ['RET']);
            if (retCandidate) {
                const ai = aIdx.get(`${retCandidate}__${dateStr}`)!;
                const meta = shiftMetaForBand(neededBand);
                result[ai] = { ...result[ai], positionName: posName || result[ai].positionName, code: neededBand, name: meta.name, hours: meta.hours, startTime: meta.startTime, endTime: meta.endTime, isFranco: false };
                gaps.push({ absentEmpId, dateStr, band: neededBand, coveredBy: retCandidate, coverageType: 'ret' });
                continue;
            }

            // Prioridad 2: F/FF libre (Franco Trabajado)
            const francoCandidate = findByCode(result, aIdx, objectiveEmpIds, absentEmpId, dateStr, ctx, ['F', 'FF']);
            if (francoCandidate) {
                const ai = aIdx.get(`${francoCandidate}__${dateStr}`)!;
                const meta = shiftMetaForBand(neededBand);
                result[ai] = { ...result[ai], positionName: posName || result[ai].positionName, code: neededBand, name: meta.name, hours: meta.hours, startTime: meta.startTime, endTime: meta.endTime, isFranco: false };
                gaps.push({ absentEmpId, dateStr, band: neededBand, coveredBy: francoCandidate, coverageType: 'ft' });
                continue;
            }

            // Sin candidato disponible
            gaps.push({ absentEmpId, dateStr, band: neededBand, coveredBy: null, coverageType: 'ft_required' });
        }
    }

    const coveredCount = gaps.filter(g => g.coveredBy !== null).length;
    const ftRequiredCount = gaps.filter(g => g.coverageType === 'ft_required').length;
    const uncoveredCount = gaps.filter(g => g.coverageType === 'uncovered').length;
    const francoNaturalCount = gaps.filter(g => g.coverageType === 'franco_natural').length;

    return { assignments: result, gaps, coveredCount, ftRequiredCount, uncoveredCount, francoNaturalCount };
}

function findByCode(
    assignments: V2Assignment[],
    aIdx: Map<string, number>,
    objectiveEmpIds: Set<string>,
    absentEmpId: string,
    dateStr: string,
    ctx: V2EngineContext,
    codes: string[],
): string | null {
    const codeSet = new Set(codes);
    for (const empId of objectiveEmpIds) {
        if (empId === absentEmpId) continue;
        if (ctx.absences[empId]?.has(dateStr)) continue;
        const ai = aIdx.get(`${empId}__${dateStr}`);
        if (ai !== undefined && codeSet.has(assignments[ai].code)) return empId;
    }
    return null;
}

function shiftMetaForBand(band: string): { name: string; hours: number; startTime: string; endTime: string } {
    const defaults: Record<string, { name: string; hours: number; startTime: string; endTime: string }> = {
        M:   { name: 'Mañana',   hours: 8,  startTime: '07:00', endTime: '15:00' },
        T:   { name: 'Tarde',    hours: 8,  startTime: '15:00', endTime: '23:00' },
        N:   { name: 'Noche',    hours: 8,  startTime: '23:00', endTime: '07:00' },
        D12: { name: 'Diurno',   hours: 12, startTime: '07:00', endTime: '19:00' },
        N12: { name: 'Nocturno', hours: 12, startTime: '19:00', endTime: '07:00' },
    };
    return defaults[band] ?? defaults.M;
}
