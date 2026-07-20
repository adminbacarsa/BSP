/**
 * Fase 4 VPLAN — estrategia según modo de corrida.
 */

import type { VplanRunMode, VplanStrategy } from '../vplan.types';
import { getRotationProfile } from '../vplan.rotation';
import { buildVplanPlanningMethod } from '../vplan.planning-method';
import { buildVplanCycleSemantics } from '../vplan.cycle-semantics';
import type { PlanningRulesConfig } from '../../planning/planning-rules.types';
import type { VplanPositionDef } from '../vplan.positions';
import type { VplanDemandModel, VplanFeasibilityReport, VplanSupplyModel } from '../vplan.types';

export function buildVplanStrategy(opts: {
  mode: VplanRunMode;
  preferredCycle?: string;
  hasExistingAssignments: boolean;
  hasTrailing: boolean;
  hasPrevMonthShifts?: boolean;
  demand?: VplanDemandModel;
  supply?: VplanSupplyModel;
  feasibility?: VplanFeasibilityReport;
  positions?: VplanPositionDef[];
  trailingEmployeeCount?: number;
  planningRules?: PlanningRulesConfig;
}): VplanStrategy {
  const cycle = opts.preferredCycle ?? '6+2';
  const rot = getRotationProfile(cycle);

  const rotNote = `Rotación ${rot.shiftHours}h: subgrupo ${rot.subgroupSize} (${rot.workersPerDay} trab + ${rot.francosPerDay}F/día), bloque ${rot.workBlockDays}+${rot.restBlockDays}`;

  const base: VplanStrategy = {
    cycle,
    absenceTiming: 'pre_block',
    continuity: 'reset',
    engine: cycle === '4+2' ? 'Cycle4x2D12N12' : 'FixedBandFloater',
    modes: {
      useTrailing: false,
      preserveExisting: false,
      patchAbsencesPostGenerate: true,
    },
    notes: [rotNote],
  };

  const withNotes = (extra: string[]): VplanStrategy => ({
    ...base,
    notes: [rotNote, ...extra],
  });

  switch (opts.mode) {
    case 'CONTINUE':
      return attachPlanningMethod({
        ...withNotes(['Continuar rachas del mes anterior (turnos junio + planificacion_estados)']),
        continuity: 'continue_streaks',
        absenceTiming: 'pre_block',
        modes: {
          useTrailing: opts.hasTrailing || Boolean(opts.hasPrevMonthShifts),
          preserveExisting: false,
          patchAbsencesPostGenerate: true,
        },
      }, opts);
    case 'COMPLETE':
      return attachPlanningMethod({
        ...withNotes(['Preservar celdas ya planificadas; generación base para huecos']),
        continuity: 'continue_streaks',
        absenceTiming: 'hybrid',
        modes: {
          useTrailing: opts.hasTrailing,
          preserveExisting: true,
          patchAbsencesPostGenerate: true,
        },
      }, opts);
    case 'RESTORE':
    case 'REPLAN_ABSENCES':
      return attachPlanningMethod({
        ...withNotes(['Re-armar días afectados por licencias o novedades']),
        absenceTiming: 'post_replan',
        continuity: 'continue_streaks',
        modes: {
          useTrailing: opts.hasTrailing,
          preserveExisting: opts.hasExistingAssignments,
          patchAbsencesPostGenerate: true,
        },
      }, opts);
    case 'REBALANCE_HOURS':
      return attachPlanningMethod({
        ...withNotes(['Prioridad cierre horario vs SLA sin cambiar esquema']),
        absenceTiming: 'hybrid',
        modes: {
          useTrailing: opts.hasTrailing,
          preserveExisting: true,
          patchAbsencesPostGenerate: false,
        },
      }, opts);
    case 'MIGRATE_CYCLE':
      return attachPlanningMethod({
        ...withNotes([`Migración de ciclo hacia ${cycle}`]),
        engine: 'CycleMigrator',
        absenceTiming: 'pre_block',
        modes: {
          useTrailing: false,
          preserveExisting: false,
          patchAbsencesPostGenerate: true,
        },
      }, opts);
    case 'GREENFIELD':
    default:
      return attachPlanningMethod({
        ...withNotes(['Cronograma desde cero (sin trailing del mes anterior)']),
        continuity: 'reset',
        modes: {
          useTrailing: false,
          preserveExisting: false,
          patchAbsencesPostGenerate: true,
        },
      }, opts);
  }
}

function attachPlanningMethod(
  strategy: VplanStrategy,
  opts: Parameters<typeof buildVplanStrategy>[0],
): VplanStrategy {
  const cycleSemantics = buildVplanCycleSemantics(strategy.cycle, opts.planningRules ?? null);
  if (!opts.positions?.length) {
    return { ...strategy, cycleSemantics };
  }
  return {
    ...strategy,
    cycleSemantics,
    planningMethod: buildVplanPlanningMethod({
      strategy,
      mode: opts.mode,
      demand: opts.demand,
      supply: opts.supply,
      feasibility: opts.feasibility,
      positions: opts.positions,
      trailingEmployeeCount: opts.trailingEmployeeCount,
      cycleSemantics,
    }),
  };
}
