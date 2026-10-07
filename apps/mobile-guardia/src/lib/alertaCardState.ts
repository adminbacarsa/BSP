import { isAvisoEntrante } from './avisosCc';
import { esNotifRetencion } from './retencionTarjeta';

/**
 * Estado de la tarjeta de alerta. Cierra Aceptar/Rechazar/Me enteré cuando
 * la convocatoria ya no está pendiente, venció el plazo o terminó el hueco.
 */

const COVERAGE_TYPES = new Set(['CONVOCATORIA_COBERTURA', 'RETENCION', 'ADELANTO']);

const COVERED_REASONS = new Set([
  'ALREADY_COVERED',
  'FULL',
  'CLAIM_HELD_BY_OTHER_CONVOCATORIA',
  'HUECO_CUBIERTO',
]);

export type AlertaLocalKind =
  | 'ACCEPTED'
  | 'REJECTED'
  | 'ACK'
  | 'vencida'
  | 'cancelada'
  | 'cubierta';

export type AlertaConvocatoriaVista = {
  status?: string;
  type?: string;
  timeoutAt?: unknown;
  endTime?: unknown;
  cancelReason?: string;
  respondedAt?: unknown;
  cancelledAt?: unknown;
  candidateEmployeeId?: string;
};

export type AlertaCardInput = {
  type?: string;
  read?: boolean;
  needsAck?: boolean;
  ackedAt?: unknown;
  response?: string;
  respondedAt?: unknown;
  endTime?: unknown;
  timeoutAt?: unknown;
  title?: string;
  conv?: AlertaConvocatoriaVista | null;
  local?: { kind: AlertaLocalKind; atMs: number } | null;
  nowMs: number;
  closedAt?: unknown;
  closedMotivo?: string;
};

export type AlertaCardState = {
  closed: boolean;
  showCoverageButtons: boolean;
  /** ENTRANTE / LLEGADA_TARDE: abre 10/15/30 y «Tengo un problema», no Aceptar/Rechazar. */
  showVenisButton: boolean;
  showAckButton: boolean;
  /** Aceptada | Rechazada | Enterado | Vencida | Cancelada por Operaciones | Cubierta por otro */
  label: string | null;
  atMs: number | null;
};

function ms(val: unknown): number {
  if (val == null || val === '') return 0;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (val instanceof Date) {
    const t = val.getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof val === 'object') {
    const o = val as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof o.toMillis === 'function') {
      const t = o.toMillis();
      return Number.isFinite(t) ? t : 0;
    }
    const seconds = o.seconds ?? o._seconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) return seconds * 1000;
  }
  if (typeof val === 'string') {
    const t = new Date(val).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

function isCoverage(type: string | undefined): boolean {
  return COVERAGE_TYPES.has(String(type || '').trim().toUpperCase());
}

function closed(
  label: string,
  atMs: number | null,
): AlertaCardState {
  return {
    closed: true,
    showCoverageButtons: false,
    showVenisButton: false,
    showAckButton: false,
    label,
    atMs: atMs && atMs > 0 ? atMs : null,
  };
}

function fromConvStatus(conv: AlertaConvocatoriaVista): AlertaCardState | null {
  const status = String(conv.status || '').trim().toUpperCase();
  if (!status || status === 'PENDING' || status === 'ESCALATED') return null;
  const at = ms(conv.respondedAt) || ms(conv.cancelledAt) || ms(conv.timeoutAt) || ms(conv.endTime);
  if (status === 'ACCEPTED') return closed('Aceptada', at);
  if (status === 'REJECTED') return closed('Rechazada', at);
  if (status === 'TIMEOUT' || status === 'EXPIRED') return closed('Vencida', ms(conv.timeoutAt) || at);
  if (status === 'CANCELLED' || status === 'CANCELED') {
    const reason = String(conv.cancelReason || '').trim().toUpperCase();
    if (COVERED_REASONS.has(reason)) return closed('Cubierta por otro', ms(conv.cancelledAt) || at);
    return closed('Cancelada por Operaciones', ms(conv.cancelledAt) || at);
  }
  return closed('Vencida', at);
}

function fromClock(timeoutAt: unknown, endTime: unknown, nowMs: number): AlertaCardState | null {
  const timeout = ms(timeoutAt);
  if (timeout > 0 && nowMs > timeout) return closed('Vencida', timeout);
  const end = ms(endTime);
  if (end > 0 && nowMs > end) return closed('Vencida', end);
  return null;
}

export function resolveAlertaCard(input: AlertaCardInput): AlertaCardState {
  const open: AlertaCardState = {
    closed: false,
    showCoverageButtons: false,
    showVenisButton: false,
    showAckButton: false,
    label: null,
    atMs: null,
  };

  const typeUp = String(input.type || '').trim().toUpperCase();
  if (esNotifRetencion(typeUp) && (ms(input.closedAt) > 0 || String(input.closedMotivo || '').trim())) {
    return closed(String(input.closedMotivo || '').trim() || 'Retención terminada', ms(input.closedAt) || null);
  }
  if (typeUp === 'CONSULTA_CUBIERTA') return closed('Ya se asignó a otra persona', null);
  if (typeUp === 'CONSULTA_CANCELADA') return closed('Ya no hace falta', null);

  if (isCoverage(input.type)) {
    const live = input.conv ? fromConvStatus(input.conv) : null;
    if (live) return live;

    const inboxResponse = String(input.response || '').trim().toUpperCase();
    if (inboxResponse === 'ACCEPTED') return closed('Aceptada', ms(input.respondedAt));
    if (inboxResponse === 'REJECTED') return closed('Rechazada', ms(input.respondedAt));

    const local = input.local;
    if (local?.kind === 'ACCEPTED') return closed('Aceptada', local.atMs);
    if (local?.kind === 'REJECTED') return closed('Rechazada', local.atMs);
    if (local?.kind === 'vencida') return closed('Vencida', local.atMs);
    if (local?.kind === 'cancelada') return closed('Cancelada por Operaciones', local.atMs);
    if (local?.kind === 'cubierta') return closed('Cubierta por otro', local.atMs);

    const clock = fromClock(
      input.conv?.timeoutAt ?? input.timeoutAt,
      input.conv?.endTime ?? input.endTime,
      input.nowMs,
    );
    if (clock) return clock;

    if (
      isAvisoEntrante({
        type: input.type,
        title: input.title,
        convType: input.conv?.type,
      })
    ) {
      return { ...open, showVenisButton: true };
    }
    return { ...open, showCoverageButtons: true };
  }

  if (input.local?.kind === 'ACK' || ms(input.ackedAt) > 0) {
    return closed('Enterado', input.local?.kind === 'ACK' ? input.local.atMs : ms(input.ackedAt));
  }
  if (input.needsAck) return { ...open, showAckButton: true };
  return open;
}

export function alertaCuentaSinLeer(input: AlertaCardInput): boolean {
  if (resolveAlertaCard(input).closed) return false;
  if (input.needsAck) return true;
  return input.read !== true;
}

export function alertaCuentaPorConfirmar(input: AlertaCardInput): boolean {
  if (resolveAlertaCard(input).closed) return false;
  return input.needsAck === true;
}
