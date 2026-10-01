export type GuardTone = 'ok' | 'ret' | 'aus' | 'late' | 'vac' | 'plan';

export interface GuardFlags {
  isRetention?: boolean;
  isPendingRetention?: boolean;
  isPresent?: boolean;
  isCompleted?: boolean;
  isAbsent?: boolean;
  isPotentialAbsence?: boolean;
  isLateUnnotified?: boolean;
  isLateNotified?: boolean;
  isUnassigned?: boolean;
  isFuture?: boolean;
  isImminent?: boolean;
  retentionMinutes?: number;
}

/** Mismos colores que la tarjeta del Centro de Control. No reclasifica el turno. */
export function guardTone(shift: GuardFlags): GuardTone {
  if (shift.isRetention || shift.isPendingRetention) return 'ret';
  if (shift.isPresent && !shift.isCompleted) return 'ok';
  if (shift.isAbsent || shift.isPotentialAbsence) return 'aus';
  if (shift.isLateNotified || shift.isLateUnnotified) return 'late';
  if (shift.isUnassigned) return 'vac';
  return 'plan';
}

export function guardStatusLabel(shift: GuardFlags): string {
  const tone = guardTone(shift);
  if (tone === 'ret') {
    const mins = Number(shift.retentionMinutes || 0);
    return mins > 0 ? `Retenido · ${mins} min` : 'Retenido';
  }
  if (tone === 'ok') return 'Activo';
  if (tone === 'aus') return 'Ausente · no llegó';
  if (tone === 'late') return 'Tarde';
  if (tone === 'vac') return 'Vacante';
  return 'Plan';
}

export function coveragePct(counts: { active: number; retention: number; absent: number; vacant: number }): number {
  const covered = counts.active + counts.retention;
  const denom = covered + counts.absent + counts.vacant;
  if (denom <= 0) return 100;
  return Math.round((covered / denom) * 100);
}
