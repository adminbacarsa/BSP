import type { Shift } from '@cosp/portal-types';
import type { CheckInTiming } from './portalCheckIn';
import { isConvocadoCoverageShift, lateNoNoticeCheckInCopy } from './evaluateCheckInWindow.ts';
import { advanceStartLine, extendUntilLine } from './convocadoArrival';
import { toDate, formatTimeAr } from '../utils/dates.ts';

export type CheckInUiStatus =
  | 'none'
  | 'too_early'
  | 'ready'
  | 'pending_review'
  | 'rejected'
  | 'present'
  | 'late_notified'
  | 'late_window'
  | 'late_no_notice'
  | 'shift_ended'
  | 'trace_registration'
  | 'blocked';

export type CheckInUiStatusView = {
  status: CheckInUiStatus;
  title: string;
  subtitle?: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  /** Texto del botón de fichada cuando no es «Presente». */
  actionLabel?: string;
};

function normRequestStatus(raw?: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/Á/g, 'A');
}

export function isShiftPresent(shift: Shift): boolean {
  const rawStatus = String(shift.status ?? '').toUpperCase();
  return (
    shift.isPresent === true ||
    rawStatus === 'PRESENT' ||
    rawStatus === 'INPROGRESS' ||
    !!shift.checkInTime ||
    !!shift.checkInAt ||
    !!shift.realStartTime ||
    !!shift.presentAt
  );
}

function punchDate(shift: Shift): Date | null {
  return toDate(shift.checkInAt) ?? toDate(shift.checkInTime) ?? toDate(shift.presentAt);
}

/** Hora que se muestra: la de pago (`realStartTime`). Si fichó antes, el inicio planificado. */
export function presentArrivalCopy(shift: Shift): { title: string; subtitle?: string } {
  const isOpsCoverage = String(shift.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE';
  const coverage = isOpsCoverage ? 'Cobertura' : undefined;
  const planned = toDate(shift.startTime);
  const punch = punchDate(shift);
  const pay =
    toDate(shift.realStartTime) ??
    (planned && punch && punch.getTime() < planned.getTime() ? planned : punch);
  if (!pay) {
    return { title: 'Presente confirmado', subtitle: coverage };
  }
  const lateMin = planned ? Math.round((pay.getTime() - planned.getTime()) / 60000) : 0;
  const convocado = isConvocadoCoverageShift(shift as unknown as Record<string, unknown>);
  const title =
    !convocado && lateMin > 5
      ? `Ingresaste ${formatTimeAr(pay)} (${lateMin} min tarde)`
      : `Ingresaste ${formatTimeAr(pay)}`;
  const marked =
    punch && Math.abs(punch.getTime() - pay.getTime()) >= 60_000
      ? `Marcaste ${formatTimeAr(punch)}`
      : undefined;
  const subtitle = [marked, coverage].filter(Boolean).join(' · ') || undefined;
  return { title, subtitle };
}

export function isCheckInRequestRejected(shift: Shift): boolean {
  const s = normRequestStatus(shift.checkInRequestStatus);
  return s === 'REJECTED' || s === 'RECHAZADO' || s === 'CANCELLED' || s === 'CANCELADO';
}

export function resolveCheckInUiStatus(
  shift: Shift | null | undefined,
  timing: CheckInTiming | null,
  opts?: { offlinePendingForShift?: boolean },
): CheckInUiStatusView {
  if (!shift || shift.isFranco) {
    return { status: 'none', title: '', tone: 'neutral' };
  }

  if (isShiftPresent(shift)) {
    const arrival = presentArrivalCopy(shift);
    const extended = extendUntilLine(shift as never);
    if (extended) {
      return {
        status: 'present',
        title: extended,
        subtitle: arrival.title,
        tone: 'success',
      };
    }
    return {
      status: 'present',
      title: arrival.title,
      subtitle: arrival.subtitle,
      tone: 'success',
    };
  }

  if (isCheckInRequestRejected(shift)) {
    return {
      status: 'rejected',
      title: 'Fichada rechazada',
      subtitle: 'Contactá a operaciones o reintentá desde el puesto',
      tone: 'danger',
    };
  }

  if (shift.checkInRequestedAt && !isShiftPresent(shift)) {
    return {
      status: 'pending_review',
      title: 'Solicitud en revisión',
      subtitle: 'Operaciones está validando tu presente',
      tone: 'warning',
    };
  }

  if (opts?.offlinePendingForShift) {
    return {
      status: 'pending_review',
      title: 'Pendiente de sincronizar',
      subtitle: 'Se enviará al recuperar conexión',
      tone: 'info',
    };
  }

  // Rechazos de ventana alineados al servidor (prioridad sobre late/ready).
  if (String(timing?.rejectCode || '') === 'ALTA_ARCA_PENDIENTE') {
    return {
      status: 'blocked',
      title: 'Alta en trámite — no podés fichar todavía',
      subtitle: timing?.rejectMessage,
      tone: 'warning',
    };
  }

  if (timing?.rejectCode === 'TRACE_REGISTRATION') {
    return {
      status: 'trace_registration',
      title: 'Registro de extensión/adelanto',
      subtitle: timing.rejectMessage ?? 'No se ficha este turno; ficha el propio.',
      tone: 'neutral',
    };
  }

  if (timing?.rejectCode === 'SHIFT_ENDED') {
    return {
      status: 'shift_ended',
      title: 'Turno terminado',
      subtitle: timing.rejectMessage ?? 'El turno ya terminó; no se puede fichar.',
      tone: 'neutral',
    };
  }

  if (timing?.rejectCode === 'ABSENT') {
    return {
      status: 'blocked',
      title: 'Turno ausente',
      subtitle: timing.rejectMessage ?? 'No se puede fichar.',
      tone: 'danger',
    };
  }

  if (timing?.convocado) {
    const proximo = timing.convocadoPhase === 'proximo';
    if (timing.canCheckIn) {
      return {
        status: 'ready',
        title: proximo ? 'Cobertura aceptada' : 'En camino',
        subtitle: 'Marcá ingreso al llegar al objetivo.',
        tone: 'info',
        actionLabel: 'Marcar ingreso al llegar',
      };
    }
    const ended = String(timing.rejectCode || '') === 'SHIFT_ENDED';
    return {
      status: ended ? 'shift_ended' : 'too_early',
      title: ended ? 'Turno terminado' : proximo ? 'Cobertura aceptada' : 'En camino',
      subtitle: proximo && !ended
        ? (timing.rejectMessage || 'El ingreso se habilita 15 min antes del inicio.')
        : timing.rejectMessage,
      tone: 'neutral',
    };
  }

  const advanced = advanceStartLine(shift as never);

  if (shift.lateArrivalAt || (shift as { lateArrivalConfirmed?: boolean }).lateArrivalConfirmed) {
    const deadline = timing?.checkInDeadline;
    const until =
      deadline != null
        ? formatTimeAr(deadline)
        : undefined;
    return {
      status: 'late_notified',
      title: until ? `Llegada tarde avisada · te esperan hasta ${until}` : 'Llegada tarde avisada',
      subtitle: until ? 'Ventana de fichada extendida' : 'Operaciones fue notificado',
      tone: 'info',
    };
  }

  const isOpsCoverage = String(shift.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE';

  if (timing?.tooEarly || timing?.rejectCode === 'TOO_EARLY') {
    return {
      status: 'too_early',
      title: 'Aún no podés fichar',
      subtitle: timing?.canNotifyLate
        ? 'Disponible desde 15 min antes · podés avisar llegada tarde'
        : timing?.rejectMessage ?? 'Disponible desde 15 min antes del inicio',
      tone: 'neutral',
    };
  }

  if (timing?.lateWindow && !timing.canCheckIn) {
    return {
      status: 'late_window',
      title: timing.canNotifyLate ? 'Podés avisar llegada tarde' : 'Fuera de ventana de fichada',
      subtitle: timing.canNotifyLate
        ? 'Indicá demora de 10, 15 o 30 min'
        : timing.rejectMessage ?? 'Contactá a operaciones si hace falta',
      tone: 'warning',
    };
  }

  if (timing?.canCheckIn && timing.lateNoNotice) {
    const copy = lateNoNoticeCheckInCopy(timing.lateMinutes ?? 0);
    return {
      status: 'late_no_notice',
      title: copy.title,
      subtitle: copy.subtitle,
      tone: 'warning',
      actionLabel: copy.actionLabel,
    };
  }

  if (timing?.canCheckIn) {
    return {
      status: 'ready',
      title: advanced || (isOpsCoverage ? 'Cobertura: listo para fichar' : 'Listo para fichar'),
      subtitle: advanced
        ? 'Fichá con GPS en la ventana habitual'
        : timing.checkInDeadline
          ? `Fichá hasta las ${formatTimeAr(timing.checkInDeadline)}`
          : isOpsCoverage
            ? 'Al llegar al objetivo, marcá presente con GPS'
            : 'Usá el botón con GPS en el puesto',
      tone: 'info',
    };
  }

  if (timing?.rejectCode === 'TOO_LATE') {
    return {
      status: 'blocked',
      title: 'Fuera de ventana de fichada',
      subtitle: timing.rejectMessage ?? 'Contactá a operaciones si hace falta.',
      tone: 'warning',
    };
  }

  if (timing?.rejectMessage) {
    return {
      status: 'blocked',
      title: 'No se puede fichar',
      subtitle: timing.rejectMessage,
      tone: 'neutral',
    };
  }

  return { status: 'none', title: '', tone: 'neutral' };
}
