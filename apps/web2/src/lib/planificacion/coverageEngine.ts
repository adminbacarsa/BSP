/**
 * Motor de cobertura automática para ausencias conocidas (V/L/E/A/PG/AA).
 * Se ejecuta como post-procesado sobre las asignaciones del motor 6+2 bandas fijas.
 *
 * Prioridad (menor a mayor costo):
 *  1. ST  — empleado sin turno asignado ese día (libre)
 *  2. RET — retención pasiva (stand-by)
 *  3. ESC — escuela/capacitación (se redirige al puesto)
 *  4. FT  — franco trabajado (último recurso)
 *  → ft_required si no hay ningún candidato disponible
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
    coveredBy: string | null;
    coveredByName?: string;
    /** Tipo de cobertura aplicada o motivo de la brecha */
    coverageType: 'sin_turno' | 'ret' | 'esc' | 'ft' | 'ft_required' | 'uncovered' | 'manual';
    ftCandidates?: { empId: string; nombre: string; code: string }[];
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

            // Día franco del ausente dentro del período de licencia → sin brecha (comportamiento normal)
            if (!WORK_BANDS.has(neededBand)) continue;

            // Contar trabajadores activos en esa banda ese día
            let actualBandCount = 0;
            for (const id of objectiveEmpIds) {
                if (id === absentEmpId) continue;
                if (ctx.absences[id]?.has(dateStr)) continue;
                const ai = aIdx.get(`${id}__${dateStr}`);
                if (ai !== undefined && result[ai].code === neededBand) actualBandCount++;
            }

            // Cobertura suficiente: no se necesita acción
            if (actualBandCount >= qty) continue;

            // Asignar primer candidato disponible según prioridad CCT
            const assigned = tryAssign(result, aIdx, objectiveEmpIds, absentEmpId, dateStr, neededBand, posName, ctx);
            if (assigned) {
                gaps.push({ absentEmpId, dateStr, band: neededBand, coveredBy: assigned.empId, coverageType: assigned.type });
            } else {
                gaps.push({ absentEmpId, dateStr, band: neededBand, coveredBy: null, coverageType: 'ft_required' });
            }
        }
    }

    const coveredCount = gaps.filter(g => g.coveredBy !== null).length;
    const ftRequiredCount = gaps.filter(g => g.coverageType === 'ft_required').length;
    const uncoveredCount = gaps.filter(g => g.coverageType === 'uncovered').length;

    return { assignments: result, gaps, coveredCount, ftRequiredCount, uncoveredCount };
}

/**
 * Intenta asignar cobertura en el orden de prioridad CCT:
 * ST (sin turno) → RET → ESC → F/FF (FT)
 * Devuelve el empId y tipo de cobertura si se encontró candidato, null si no.
 */
function tryAssign(
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

    // Busca candidato por código y asigna
    const assign = (empId: string) => {
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

    // Candidato sin turno: no tiene entrada en el índice para ese día
    for (const empId of objectiveEmpIds) {
        if (empId === absentEmpId) continue;
        if (ctx.absences[empId]?.has(dateStr)) continue;
        if (!aIdx.has(`${empId}__${dateStr}`)) {
            // Sin asignación ese día — crear nueva entrada
            result.push({
                empId,
                dateStr,
                positionName: posName,
                code: neededBand,
                name: meta.name,
                hours: meta.hours,
                startTime: meta.startTime,
                endTime: meta.endTime,
                isFranco: false,
            });
            aIdx.set(`${empId}__${dateStr}`, result.length - 1);
            return { empId, type: 'sin_turno' };
        }
    }

    // RET libre
    const retId = findByCode(result, aIdx, objectiveEmpIds, absentEmpId, dateStr, ctx, ['RET']);
    if (retId && assign(retId)) return { empId: retId, type: 'ret' };

    // ESC libre
    const escId = findByCode(result, aIdx, objectiveEmpIds, absentEmpId, dateStr, ctx, ['ESC']);
    if (escId && assign(escId)) return { empId: escId, type: 'esc' };

    // F/FF libre (FT — último recurso)
    const ftId = findByCode(result, aIdx, objectiveEmpIds, absentEmpId, dateStr, ctx, ['F', 'FF']);
    if (ftId && assign(ftId)) return { empId: ftId, type: 'ft' };

    return null;
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
