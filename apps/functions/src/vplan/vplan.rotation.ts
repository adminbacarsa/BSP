/**
 * VPLAN — perfil de rotación diaria por ciclo CCT.
 *
 * 24hs (8h, M/T/N, ciclo 6+2):
 *   Subgrupo de 4 guardias por qty → cada día 3 trabajan + 1 franco.
 *   (3 bandas cubiertas; no son 5 personas.)
 *
 * 12hs (4+2, D12/N12):
 *   Subgrupo de 3 guardias por qty → cada día 2 trabajan + 1 franco.
 */

import {
  is4x2Cycle,
  maxWorkStreak,
  normalizeCycleKey,
  subgroupSize,
  type VplanCycleKey,
} from './vplan.cycle-templates';

export interface VplanRotationProfile {
  cycleKey: VplanCycleKey;
  /** Guardias en el subgrupo rotativo (= dotación por qty de puesto 24hs). */
  subgroupSize: number;
  /** Trabajando ese día dentro del subgrupo. */
  workersPerDay: number;
  /** En franco ese día dentro del subgrupo. */
  francosPerDay: number;
  /** Horas por turno de trabajo en el ciclo. */
  shiftHours: 8 | 12;
  /** Bandas activas por día (M+T+N o D12+N12). */
  bandsPerDay: number;
  /** Días consecutivos de trabajo antes del bloque de descanso CCT. */
  workBlockDays: number;
  /** Días consecutivos de franco al cerrar bloque de trabajo. */
  restBlockDays: number;
}

const REST_BLOCK: Record<VplanCycleKey, number> = {
  '6+2': 2,
  '4+2': 2,
  '5+1': 1,
  '6+1': 1,
};

/**
 * Perfil operativo del ciclo: cuántos trabajan vs franco por subgrupo y día.
 * 6+2 → 4 guardias, 3+1/día | 4+2 → 3 guardias, 2+1/día.
 */
export function getRotationProfile(cycle?: string): VplanRotationProfile {
  const cycleKey = normalizeCycleKey(cycle);
  const is12h = is4x2Cycle(cycleKey);
  const size = subgroupSize(cycleKey);
  const francos = 1;
  return {
    cycleKey,
    subgroupSize: size,
    workersPerDay: size - francos,
    francosPerDay: francos,
    shiftHours: is12h ? 12 : 8,
    bandsPerDay: is12h ? 2 : 3,
    workBlockDays: maxWorkStreak(cycleKey),
    restBlockDays: REST_BLOCK[cycleKey],
  };
}

/** Guardias necesarios por unidad qty de puesto 24hs (tamaño del subgrupo). */
export function headcountPerQtyUnit(cycle?: string): number {
  return getRotationProfile(cycle).subgroupSize;
}

/** Días de franco consecutivos al cerrar un bloque de trabajo CCT. */
export function maxRestStreak(cycle?: string): number {
  return getRotationProfile(cycle).restBlockDays;
}
