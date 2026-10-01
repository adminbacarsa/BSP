/**
 * Estados CC de llegada tarde (espejo detectarAusencias / notificarLlegadaTarde).
 * Aviso T−60…T+5. AA provisoria en max(T+30, min(ETA, T+60)).
 * Vacante recién a T+60 o si el operador declara la ausencia.
 */

export type OpsLateArrivalMonitorInput = {
  shift: Record<string, unknown>;
  startMs: number;
  nowMs: number;
  eligible: boolean;
};

export type OpsLateArrivalMonitorState = {
  isLateNotified: boolean;
  isLateUnnotified: boolean;
  isPotentialAbsence: boolean;
  minutesRemainingLate: number | null;
  lateArrivalEtaMinutes: number | null;
  lateArrivalEtaLabel: string | null;
  /** HH:MM (AR) en que el guardia respondió el ¿Venís? o avisó desde el portal. */
  lateArrivalRespondedLabel: string | null;
};

function toMs(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'seconds' in v) {
    return Number((v as { seconds: number }).seconds) * 1000;
  }
  if (typeof v === 'object' && v !== null && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

/**
 * Aviso de llegada tarde ya registrado en el turno.
 * El portal escribe `lateArrivalAt`; la convocatoria LLEGADA_TARDE escribe
 * `lateArrivalConfirmed` + ETA; el CC viejo a veces solo deja `lateETA`.
 * Cualquiera de esos es TARDE AVISADA (no TARDE SIN AVISO).
 */
export function hasLateArrivalNotice(shift: Record<string, unknown>): boolean {
  if (shift.lateArrivalAt || shift.lateArrivalConfirmed === true) return true;
  if (String(shift.checkInStatus || '').toUpperCase() === 'LATE_PENDING') return true;
  if (String(shift.lateETA || '').trim()) return true;
  if (shift.lateArrivalEtaAt) return true;
  const mins = Number(shift.lateArrivalEtaMinutes);
  return Number.isFinite(mins) && mins > 0;
}

export function readLateEtaMinutes(shift: Record<string, unknown>): number | null {
  const raw = shift.lateArrivalEtaMinutes ?? shift.etaMinutes;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function resolveLateArrivalEtaAtMs(shift: Record<string, unknown>, startMs: number): number {
  const direct = toMs(shift.lateArrivalEtaAt);
  if (direct > 0) return direct;
  const etaMin = readLateEtaMinutes(shift);
  if (etaMin != null && startMs > 0) {
    return Math.min(startMs + etaMin * 60_000, startMs + 60 * 60_000);
  }
  return 0;
}

export function resolveLateAbsenceDeadlineMs(shift: Record<string, unknown>, startMs: number): number {
  if (startMs <= 0) return 0;
  const floor = startMs + 30 * 60_000;
  const cap = startMs + 60 * 60_000;
  const etaMs = resolveLateArrivalEtaAtMs(shift, startMs);
  if (etaMs > 0) return Math.max(floor, Math.min(etaMs, cap));
  return floor;
}

export function formatLateEtaLabelAR(etaMs: number): string | null {
  if (!etaMs || !Number.isFinite(etaMs)) return null;
  return new Date(etaMs).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

export function computeOpsLateArrivalMonitorState(
  input: OpsLateArrivalMonitorInput,
): OpsLateArrivalMonitorState {
  const empty: OpsLateArrivalMonitorState = {
    isLateNotified: false,
    isLateUnnotified: false,
    isPotentialAbsence: false,
    minutesRemainingLate: null,
    lateArrivalEtaMinutes: null,
    lateArrivalEtaLabel: null,
    lateArrivalRespondedLabel: null,
  };
  if (!input.eligible || input.startMs <= 0) return empty;

  const { shift, startMs, nowMs } = input;
  const minutesPastStart = (nowMs - startMs) / 60_000;
  const hasLate = hasLateArrivalNotice(shift);
  const absenceDeadlineMs = resolveLateAbsenceDeadlineMs(shift, startMs);
  const etaAtMs = resolveLateArrivalEtaAtMs(shift, startMs);
  const etaMinutes = readLateEtaMinutes(shift);

  const isPotentialAbsence = nowMs >= absenceDeadlineMs;

  const isLateNotified = hasLate && !isPotentialAbsence;

  const isLateUnnotified =
    !hasLate
    && !isPotentialAbsence
    && minutesPastStart > 5
    && nowMs < absenceDeadlineMs;

  let minutesRemainingLate: number | null = null;
  if (isLateNotified) {
    minutesRemainingLate = Math.max(0, Math.round((absenceDeadlineMs - nowMs) / 60_000));
  }

  const lateArrivalEtaLabel =
    isLateNotified && etaAtMs > 0 ? formatLateEtaLabelAR(etaAtMs) : null;
  const respondedMs = lateArrivalRespondedAtMs(shift);
  const lateArrivalRespondedLabel =
    isLateNotified && respondedMs > 0 ? formatLateEtaLabelAR(respondedMs) : null;

  return {
    isLateNotified,
    isLateUnnotified,
    isPotentialAbsence,
    minutesRemainingLate,
    lateArrivalEtaMinutes: isLateNotified ? etaMinutes : null,
    lateArrivalEtaLabel,
    lateArrivalRespondedLabel,
  };
}

/** Instante de la respuesta del guardia: ¿Venís? (`lateArrivalConfirmedAt`) o aviso del portal (`lateArrivalAt`). */
export function lateArrivalRespondedAtMs(shift: Record<string, unknown>): number {
  return toMs(shift.lateArrivalConfirmedAt) || toMs(shift.lateArrivalAt);
}

export function opsLateArrivalBadgeLabel(shift: {
  isLateNotified?: boolean;
  isLateUnnotified?: boolean;
  lateArrivalEtaLabel?: string | null;
  lateArrivalEtaMinutes?: number | null;
  minutesRemainingLate?: number | null;
  lateArrivalRespondedLabel?: string | null;
}): string | null {
  if (shift.isLateNotified) {
    const eta = shift.lateArrivalEtaLabel ? ` · llega ~${shift.lateArrivalEtaLabel}` : '';
    const delay =
      shift.lateArrivalEtaMinutes != null ? ` (+${shift.lateArrivalEtaMinutes}m)` : '';
    const responded = shift.lateArrivalRespondedLabel ? ` · respondió ${shift.lateArrivalRespondedLabel}` : '';
    const remain =
      shift.minutesRemainingLate != null && shift.minutesRemainingLate > 0
        ? ` · ${shift.minutesRemainingLate}min`
        : '';
    return `TARDE AVISADA${delay}${eta}${responded}${remain}`;
  }
  if (shift.isLateUnnotified) return 'TARDE SIN AVISO';
  return null;
}
