export type EarlyWithdrawReplacePolicy =
  | 'NO_REPLACE'
  | 'OPERATOR_CHOICE'
  | 'REPLACE'
  | 'AUTO_REPLACE';

export type EarlyWithdrawReason =
  | 'ENFERMEDAD'
  | 'ABANDONO'
  | 'FAMILIAR'
  | 'OPERATIVO'
  | 'AUTORIZADO';

/** Horas restantes hasta fin planificado del turno (mínimo 0). */
export function hoursRemainingUntilEnd(nowMs: number, endMs: number): number {
  if (!endMs || endMs <= nowMs) return 0;
  return (endMs - nowMs) / 3600000;
}

/**
 * Umbrales retiro anticipado (spec CC):
 * - <2 h: sin reemplazo
 * - 2–3 h: según reemplazarRetiro2a3h; sin regla → operador (Auto reemplaza)
 * - >3 h o sin compañeros en objetivo → reemplazar
 */
export function resolveEarlyWithdrawReplacePolicy(opts: {
  hoursLeft: number;
  colleaguesPresent: number;
  reemplazarRetiro2a3h: boolean | null;
  isAutoMode: boolean;
  operatorReplaceChoice?: boolean | null;
}): EarlyWithdrawReplacePolicy {
  const h = opts.hoursLeft;
  const alone = opts.colleaguesPresent <= 0;

  if (h < 2 && !alone) return 'NO_REPLACE';
  if (alone || h > 3) {
    return opts.isAutoMode ? 'AUTO_REPLACE' : 'REPLACE';
  }
  if (h >= 2 && h <= 3) {
    if (opts.reemplazarRetiro2a3h === true) {
      return opts.isAutoMode ? 'AUTO_REPLACE' : 'REPLACE';
    }
    if (opts.reemplazarRetiro2a3h === false) return 'NO_REPLACE';
    if (opts.isAutoMode) return 'AUTO_REPLACE';
    if (typeof opts.operatorReplaceChoice === 'boolean') {
      return opts.operatorReplaceChoice ? 'REPLACE' : 'NO_REPLACE';
    }
    return 'OPERATOR_CHOICE';
  }
  if (h < 2 && alone) {
    return opts.isAutoMode ? 'AUTO_REPLACE' : 'REPLACE';
  }
  return opts.isAutoMode ? 'AUTO_REPLACE' : 'REPLACE';
}

export function rrhhPartialForReason(reason: EarlyWithdrawReason): {
  absenceType: 'E' | 'A' | 'AA';
  typeLabel: string;
  disciplinary: boolean;
} {
  switch (reason) {
    case 'ENFERMEDAD':
      return { absenceType: 'E', typeLabel: 'Retiro Anticipado (Parcial — Enfermedad)', disciplinary: false };
    case 'ABANDONO':
      return {
        absenceType: 'AA',
        typeLabel: 'Retiro Anticipado (Parcial — Abandono)',
        disciplinary: true,
      };
    case 'FAMILIAR':
    case 'OPERATIVO':
    case 'AUTORIZADO':
    default:
      return { absenceType: 'A', typeLabel: 'Retiro Anticipado (Parcial — Autorizado)', disciplinary: false };
  }
}
