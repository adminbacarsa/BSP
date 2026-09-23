export type EarlyWithdrawReplacePolicy =
  | 'NO_REPLACE'
  | 'OPERATOR_CHOICE'
  | 'REPLACE'
  | 'AUTO_REPLACE';

export function hoursRemainingUntilEnd(nowMs: number, endMs: number): number {
  if (!endMs || endMs <= nowMs) return 0;
  return (endMs - nowMs) / 3600000;
}

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
