/**
 * Fase 4 VPLAN — estrategia según modo de corrida.
 */

import type { VplanRunMode, VplanStrategy } from '../vplan.types';

export function buildVplanStrategy(opts: {
  mode: VplanRunMode;
  preferredCycle?: string;
  hasExistingAssignments: boolean;
  hasTrailing: boolean;
}): VplanStrategy {
  const cycle = opts.preferredCycle ?? '6+2';

  const base: VplanStrategy = {
    cycle,
    absenceTiming: 'pre_block',
    continuity: 'reset',
    engine: cycle === '4+2' ? 'SixPlusOne' : 'FixedBandFloater',
    modes: {
      useTrailing: false,
      preserveExisting: false,
      patchAbsencesPostGenerate: true,
    },
    notes: [],
  };

  switch (opts.mode) {
    case 'CONTINUE':
      return {
        ...base,
        continuity: 'continue_streaks',
        absenceTiming: 'pre_block',
        modes: {
          useTrailing: opts.hasTrailing,
          preserveExisting: false,
          patchAbsencesPostGenerate: true,
        },
        notes: ['Continuar rachas del mes anterior si hay trailing en planificacion_estados'],
      };
    case 'COMPLETE':
      return {
        ...base,
        continuity: 'continue_streaks',
        absenceTiming: 'hybrid',
        modes: {
          useTrailing: opts.hasTrailing,
          preserveExisting: true,
          patchAbsencesPostGenerate: true,
        },
        notes: ['Preservar celdas ya planificadas; generación base para huecos'],
      };
    case 'RESTORE':
    case 'REPLAN_ABSENCES':
      return {
        ...base,
        absenceTiming: 'post_replan',
        continuity: 'continue_streaks',
        modes: {
          useTrailing: opts.hasTrailing,
          preserveExisting: opts.hasExistingAssignments,
          patchAbsencesPostGenerate: true,
        },
        notes: ['Re-armar días afectados por licencias o novedades'],
      };
    case 'REBALANCE_HOURS':
      return {
        ...base,
        absenceTiming: 'hybrid',
        modes: {
          useTrailing: opts.hasTrailing,
          preserveExisting: true,
          patchAbsencesPostGenerate: false,
        },
        notes: ['Prioridad cierre horario vs SLA sin cambiar esquema'],
      };
    case 'MIGRATE_CYCLE':
      return {
        ...base,
        engine: 'CycleMigrator',
        absenceTiming: 'pre_block',
        modes: {
          useTrailing: false,
          preserveExisting: false,
          patchAbsencesPostGenerate: true,
        },
        notes: [`Migración de ciclo hacia ${cycle}`],
      };
    case 'GREENFIELD':
    default:
      return {
        ...base,
        notes: ['Cronograma desde cero'],
      };
  }
}
