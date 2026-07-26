/**
 * Motor de cobertura automática para ausencias conocidas (V/L/E/A/PG/AA).
 * Post-procesado sobre el cronograma 6+2 bandas fijas.
 *
 * Orden COSP (ver `ABSENCE_COVERAGE_PRIORITY_STEPS`):
 *  1. Extensión 12h (D12+N12) — `applyAbsenceSplitCoverage`, no en este módulo
 *  2. RET otro objetivo / RET interno / sin turno (ST) en plantilla
 *  3. FT (franco trabajado) — NUNCA automático; último recurso, costo doble
 *
 * Asignación automática en este módulo: ST → RET → ESC (FT excluido).
 * Día franco del ausente en su ciclo → sin brecha.
 */

import { CYCLE_24_MTN } from './fixedBandFloaterScheduleEngine';
import type { V2Assignment, V2EngineContext } from './autoScheduleEngineV2';
import { rankReplacementCandidates } from './coverageCandidateRank';

const WORK_BANDS = new Set(['M', 'T', 'N']);

export type CoverageGap = {
    absentEmpId: string;
    absentName?: string;
    dateStr: string;
    band: string;
    positionName: string;   // puesto donde está la brecha (del empleado ausente)
    coveredBy: string | null;
    coveredByName?: string;
    /**
     * sin_turno / ret / esc = cubierto automáticamente (no rompe ciclo 6+2)
     * ft_required = sin candidatos ST/RET/ESC; se muestran candidatos FT para decisión manual
     * uncovered = sin ningún candidato
     * manual = asignado manualmente desde el wizard
     */
    coverageType: 'sin_turno' | 'ret' | 'esc' | 'ft_required' | 'uncovered' | 'manual';
    /** Candidatos F/FF disponibles ese día (para mostrar en panel, NO se asignan automáticamente) */
    ftCandidates?: { empId: string; code: string }[];
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
 */
export function applyAbsenceCoverage(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    openingSlotByEmp: Record<string, number>,
    skipDayPositionKeys?: Set<string>,
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

        for (const dateStr of absentDates.keys()) {
            const di = ctx.daysInMonth.findIndex(d => ctx.getDateKey(d) === dateStr);
            if (di < 0) continue;

            if (skipDayPositionKeys?.has(`${dateStr}__${posName}`)) continue;

            const neededBand = CYCLE_24_MTN[(opening + di) % 24] as string;

            // Día franco del ausente dentro del período de licencia → sin brecha (comportamiento normal CCT)
            if (!WORK_BANDS.has(neededBand)) continue;

            // Intentar asignación automática: ST → RET → ESC (FT NO se asigna automáticamente)
            const assigned = tryAutoAssign(result, aIdx, objectiveEmpIds, absentEmpId, dateStr, neededBand, posName, ctx);

            if (assigned) {
                gaps.push({ absentEmpId, dateStr, band: neededBand, positionName: posName, coveredBy: assigned.empId, coverageType: assigned.type });
            } else {
                // Sin candidatos ST/RET/ESC → listar candidatos FT para decisión manual
                const ftCandidates = getFtCandidates(result, aIdx, objectiveEmpIds, absentEmpId, dateStr, ctx);
                gaps.push({
                    absentEmpId,
                    dateStr,
                    band: neededBand,
                    positionName: posName,
                    coveredBy: null,
                    coverageType: 'ft_required',
                    ftCandidates,
                });
            }
        }
    }

    const coveredCount = gaps.filter(g => g.coveredBy !== null).length;
    const ftRequiredCount = gaps.filter(g => g.coverageType === 'ft_required').length;
    const uncoveredCount = gaps.filter(g => g.coverageType === 'uncovered').length;

    return { assignments: result, gaps, coveredCount, ftRequiredCount, uncoveredCount };
}

/**
 * Asignación automática: ST → RET → ESC.
 * FT queda excluido — rompe el ciclo 6+2 y requiere decisión del supervisor.
 */
function tryAutoAssign(
    result: V2Assignment[],
    aIdx: Map<string, number>,
    objectiveEmpIds: Set<string>,
    absentEmpId: string,
    dateStr: string,
    neededBand: string,
    posName: string,
    ctx: V2EngineContext,
): { empId: string; type: CoverageGap['coverageType'] } | null {
    const meta = shiftMetaForBand(neededBand);

    const groupIds = [...objectiveEmpIds];
    const ranked = rankReplacementCandidates(groupIds, ctx, {
        absentEmpId,
        positionName: posName,
        dateStr,
        coverageWisdom: ctx.coverageWisdom,
        wisdomBand: neededBand,
        shiftCode: neededBand,
    });

    const assignExisting = (empId: string): boolean => {
        const ai = aIdx.get(`${empId}__${dateStr}`);
        if (ai === undefined) return false;
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
        return true;
    };

    // 1. Sin turno: empleado sin asignación ese día (prioridad titular / conocido del objetivo)
    for (const empId of ranked) {
        if (!aIdx.has(`${empId}__${dateStr}`)) {
            result.push({ empId, dateStr, positionName: posName, code: neededBand, name: meta.name, hours: meta.hours, startTime: meta.startTime, endTime: meta.endTime, isFranco: false });
            aIdx.set(`${empId}__${dateStr}`, result.length - 1);
            return { empId, type: 'sin_turno' };
        }
    }

    // 2. RET libre
    const retIds = findAllByCode(result, aIdx, ranked, dateStr, ['RET']);
    for (const retId of retIds) {
        if (assignExisting(retId)) return { empId: retId, type: 'ret' };
    }

    // 3. ESC libre
    const escIds = findAllByCode(result, aIdx, ranked, dateStr, ['ESC']);
    for (const escId of escIds) {
        if (assignExisting(escId)) return { empId: escId, type: 'esc' };
    }

    return null;
}

function findAllByCode(
    assignments: V2Assignment[],
    aIdx: Map<string, number>,
    pool: string[],
    dateStr: string,
    codes: string[],
): string[] {
    const codeSet = new Set(codes);
    const out: string[] = [];
    for (const empId of pool) {
        const ai = aIdx.get(`${empId}__${dateStr}`);
        if (ai !== undefined && codeSet.has(assignments[ai].code)) out.push(empId);
    }
    return out;
}

/** Devuelve empleados con F/FF ese día disponibles para FT manual */
function getFtCandidates(
    assignments: V2Assignment[],
    aIdx: Map<string, number>,
    objectiveEmpIds: Set<string>,
    absentEmpId: string,
    dateStr: string,
    ctx: V2EngineContext,
): { empId: string; code: string }[] {
    const candidates: { empId: string; code: string }[] = [];
    for (const empId of objectiveEmpIds) {
        if (empId === absentEmpId) continue;
        if (ctx.absences[empId]?.has(dateStr)) continue;
        const ai = aIdx.get(`${empId}__${dateStr}`);
        if (ai !== undefined && (assignments[ai].code === 'F' || assignments[ai].code === 'FF')) {
            candidates.push({ empId, code: assignments[ai].code });
        }
    }
    return candidates;
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
