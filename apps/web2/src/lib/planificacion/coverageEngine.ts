/**
 * Motor de cobertura automática para ausencias conocidas (V/L/E/A/PG/AA).
 * Se ejecuta como post-procesado sobre las asignaciones del motor 6+2 bandas fijas.
 *
 * Prioridad de asignación AUTOMÁTICA (no rompen el ciclo 6+2):
 *  1. ST  — empleado sin turno asignado ese día (libre)
 *  2. RET — retención pasiva (stand-by)
 *  3. ESC — escuela/capacitación (se redirige al puesto)
 *
 * FT (franco trabajado) NO se asigna automáticamente porque rompe el ciclo 6+2
 * y requiere decisión explícita del supervisor. Se detectan candidatos y se
 * muestran en el panel para asignación manual.
 *
 * Días franco del ausente (F/FF en su ciclo 6+2): el período de licencia puede
 * abarcarlos pero NO requieren cobertura — se saltan silenciosamente.
 * Puestos sin operación ese día: si el conteo actual ≥ qty no se genera brecha.
 */

import { CYCLE_24_MTN } from './fixedBandFloaterScheduleEngine';
import type { V2Assignment, V2EngineContext, V2PositionDef } from './autoScheduleEngineV2';

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

            // Día franco del ausente dentro del período de licencia → sin brecha (comportamiento normal CCT)
            if (!WORK_BANDS.has(neededBand)) continue;

            // Contar trabajadores activos en esa banda ese día
            let actualBandCount = 0;
            for (const id of objectiveEmpIds) {
                if (id === absentEmpId) continue;
                if (ctx.absences[id]?.has(dateStr)) continue;
                const ai = aIdx.get(`${id}__${dateStr}`);
                if (ai !== undefined && result[ai].code === neededBand) actualBandCount++;
            }

            if (actualBandCount >= qty) continue; // cobertura suficiente

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

    // 1. Sin turno: empleado sin asignación ese día
    for (const empId of objectiveEmpIds) {
        if (empId === absentEmpId) continue;
        if (ctx.absences[empId]?.has(dateStr)) continue;
        if (!aIdx.has(`${empId}__${dateStr}`)) {
            result.push({ empId, dateStr, positionName: posName, code: neededBand, name: meta.name, hours: meta.hours, startTime: meta.startTime, endTime: meta.endTime, isFranco: false });
            aIdx.set(`${empId}__${dateStr}`, result.length - 1);
            return { empId, type: 'sin_turno' };
        }
    }

    // 2. RET libre
    const retId = findByCode(result, aIdx, objectiveEmpIds, absentEmpId, dateStr, ctx, ['RET']);
    if (retId && assignExisting(retId)) return { empId: retId, type: 'ret' };

    // 3. ESC libre
    const escId = findByCode(result, aIdx, objectiveEmpIds, absentEmpId, dateStr, ctx, ['ESC']);
    if (escId && assignExisting(escId)) return { empId: escId, type: 'esc' };

    return null;
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
