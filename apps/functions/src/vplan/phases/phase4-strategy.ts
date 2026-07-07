/**
 * Fase 4 VPLAN — estrategia según modo de corrida.
 */

import type { VplanRunMode, VplanStrategy } from '../vplan.types';
import { getRotationProfile } from '../vplan.rotation';

export function buildVplanStrategy(opts: {
  mode: VplanRunMode;
  preferredCycle?: string;
  hasExistingAssignments: boolean;
  hasTrailing: boolean;
  hasPrevMonthShifts?: boolean;
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
      return {
        ...withNotes(['Continuar rachas del mes anterior (turnos junio + planificacion_estados)']),
        continuity: 'continue_streaks',
        absenceTiming: 'pre_block',
        modes: {
          useTrailing: opts.hasTrailing || Boolean(opts.hasPrevMonthShifts),
          preserveExisting: false,
          patchAbsencesPostGenerate: true,
        },
      };
    case 'COMPLETE':
      return {
        ...withNotes(['Preservar celdas ya planificadas; generación base para huecos']),
        continuity: 'continue_streaks',
        absenceTiming: 'hybrid',
        modes: {
          useTrailing: opts.hasTrailing,
          preserveExisting: true,
          patchAbsencesPostGenerate: true,
        },
      };
    case 'RESTORE':
    case 'REPLAN_ABSENCES':
      return {
        ...withNotes(['Re-armar días afectados por licencias o novedades']),
        absenceTiming: 'post_replan',
        continuity: 'continue_streaks',
        modes: {
          useTrailing: opts.hasTrailing,
          preserveExisting: opts.hasExistingAssignments,
          patchAbsencesPostGenerate: true,
        },
      };
    case 'REBALANCE_HOURS':
      return {
        ...withNotes(['Prioridad cierre horario vs SLA sin cambiar esquema']),
        absenceTiming: 'hybrid',
        modes: {
          useTrailing: opts.hasTrailing,
          preserveExisting: true,
          patchAbsencesPostGenerate: false,
        },
      };
    case 'MIGRATE_CYCLE':
      return {
        ...withNotes([`Migración de ciclo hacia ${cycle}`]),
        engine: 'CycleMigrator',
        absenceTiming: 'pre_block',
        modes: {
          useTrailing: false,
          preserveExisting: false,
          patchAbsencesPostGenerate: true,
        },
      };
    case 'GREENFIELD':
    default:
      return {
        ...withNotes(['Cronograma desde cero (sin trailing del mes anterior)']),
        continuity: 'reset',
        modes: {
          useTrailing: false,
          preserveExisting: false,
          patchAbsencesPostGenerate: true,
        },
      };
  }
}
