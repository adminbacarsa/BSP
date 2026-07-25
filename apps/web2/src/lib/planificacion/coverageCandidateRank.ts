/**
 * Orden de candidatos para cubrir ausencias / huecos SLA.
 * Prioriza quien ya conoce el objetivo y el puesto (titular > mismo grupo > objetivo).
 */

import type { V2Assignment, V2EngineContext } from './autoScheduleEngineV2';
import type { ExperienciaObjetivosMap } from './experienciaObjetivos';
import { computeExperienciaNivel } from './experienciaObjetivos';
import type { PlanningCoverageWisdom } from './planningCoverageWisdom';
import { rankCoverersFromWisdom } from './planningCoverageWisdom';
import {
    buildGuardCapacityConfig,
    rankGuardCoverageCandidates,
} from './guardCapacityEvaluator';

const NIVEL_SCORE: Record<string, number> = {
    TITULAR: 400,
    CONOCIDO: 300,
    ESCUELA: 200,
    NINGUNO: 0,
};

export interface RankReplacementOptions {
    absentEmpId?: string;
    positionName?: string;
    dateStr?: string;
    /** Grupo del puesto (stats.positionGroups[pos]). */
    positionGroup?: string[];
    /** Horas facturables acumuladas — menor = mejor candidato. */
    billableHours?: Map<string, number>;
    /** Memoria de coberturas del mes anterior (opcional). */
    coverageWisdom?: PlanningCoverageWisdom | null;
    /** Banda a cubrir para ponderar sabiduría histórica. */
    wisdomBand?: string;
    /** Banda a asignar — filtra por capacidad legal del guardia. */
    shiftCode?: string;
  assignments?: V2Assignment[];
}

function experienciaScore(
    empId: string,
    objectiveId: string | undefined,
    positionName: string | undefined,
    experiencia?: ExperienciaObjetivosMap,
    preferredObjectiveId?: string | null,
): number {
    if (!objectiveId) return 0;
    const isTitular = preferredObjectiveId === objectiveId;
    const entry = experiencia?.[objectiveId];
    const nivel = computeExperienciaNivel(entry, isTitular);
    let score = NIVEL_SCORE[nivel] ?? 0;
    if (positionName && entry?.posicionesConocidas?.includes(positionName)) {
        score += 80;
    }
    return score;
}

/**
 * Ordena empleados para reemplazo: titular/conocido del objetivo → mismo puesto → menos horas.
 */
export function rankReplacementCandidates(
    empIds: string[],
    ctx: V2EngineContext,
    options: RankReplacementOptions = {},
): string[] {
    const {
        absentEmpId,
        positionName = '',
        dateStr = '',
        positionGroup = [],
        billableHours,
        coverageWisdom,
        wisdomBand,
        shiftCode,
        assignments,
    } = options;

    let pool = [...empIds].filter((id) => id !== absentEmpId);
    if (shiftCode && dateStr && assignments) {
        const capCfg = buildGuardCapacityConfig(ctx.autoCycles || [], {
            modo12: (ctx.modo12Days?.length ?? 0) > 0,
            contingency: (ctx.contingencyApretarDays?.length ?? 0) > 0,
        });
        const capacityOk = new Set(
            rankGuardCoverageCandidates(pool, dateStr, shiftCode, assignments, ctx.absences, capCfg),
        );
        pool = pool.filter((id) => capacityOk.has(id));
    }

    const wisdomRank = new Map<string, number>();
    if (coverageWisdom && wisdomBand) {
        rankCoverersFromWisdom(coverageWisdom, wisdomBand, { limit: 20 }).forEach((c, idx) => {
            wisdomRank.set(c.empId, Math.max(0, 50 - idx * 5) + c.score / 5);
        });
    }

    const groupSet = new Set(positionGroup);
    const defaultPos = ctx.defaultPositionByEmp || {};
    const objectiveId = ctx.objectiveId;

    const empById = new Map(ctx.employees.map((e) => [e.id, e]));

    return pool
        .filter((id) => !dateStr || !ctx.absences[id]?.has(dateStr))
        .sort((a, b) => {
            const ea = empById.get(a);
            const eb = empById.get(b);

            const inGroupA = groupSet.has(a) ? 1 : 0;
            const inGroupB = groupSet.has(b) ? 1 : 0;
            if (inGroupA !== inGroupB) return inGroupB - inGroupA;

            const defA = defaultPos[a] === positionName ? 1 : 0;
            const defB = defaultPos[b] === positionName ? 1 : 0;
            if (defA !== defB) return defB - defA;

            const expA = experienciaScore(
                a,
                objectiveId,
                positionName,
                (ea as { experienciaObjetivos?: ExperienciaObjetivosMap })?.experienciaObjetivos,
                ea?.preferredObjectiveId,
            );
            const expB = experienciaScore(
                b,
                objectiveId,
                positionName,
                (eb as { experienciaObjetivos?: ExperienciaObjetivosMap })?.experienciaObjetivos,
                eb?.preferredObjectiveId,
            );
            if (expA !== expB) return expB - expA;

            const titA = ea?.preferredObjectiveId === objectiveId ? 1 : 0;
            const titB = eb?.preferredObjectiveId === objectiveId ? 1 : 0;
            if (titA !== titB) return titB - titA;

            const wisA = wisdomRank.get(a) ?? 0;
            const wisB = wisdomRank.get(b) ?? 0;
            if (wisA !== wisB) return wisB - wisA;

            const ha = billableHours?.get(a) ?? 0;
            const hb = billableHours?.get(b) ?? 0;
            if (ha !== hb) return ha - hb;

            const absA = ea?.absenceRate ?? 0;
            const absB = eb?.absenceRate ?? 0;
            if (absA !== absB) return absA - absB;

            return a.localeCompare(b);
        });
}
