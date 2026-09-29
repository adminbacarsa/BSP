import type { Shift } from '@cosp/portal-types';
import type { CheckInTiming } from './portalCheckIn';
import { lateNoNoticeCheckInCopy } from './evaluateCheckInWindow';
import { toDate, formatTimeAr } from '../utils/dates';

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
    !!shift.checkInTime
  );
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
    const isOpsCoverage = String(shift.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE';
    const punch = toDate(shift.checkInAt) ?? toDate(shift.checkInTime);
    const plannedStart = toDate(shift.startTime);
    const lateMin = plannedStart && punch
      ? Math.round((punch.getTime() - plannedStart.getTime()) / 60000)
      : 0;
    const hh = punch ? formatTimeAr(punch) : '';
    const title = punch
      ? (lateMin > 5 ? `Ingresó ${hh} (${lateMin} min tarde)` : `Ingresó ${hh}`)
      : 'Presente confirmado';
    return {
      status: 'present',
      title,
      subtitle: isOpsCoverage
        ? (plannedStart ? `Turno asignado ${formatTimeAr(plannedStart)} · Cobertura` : 'Cobertura confirmada')
        : (plannedStart ? `Turno ${formatTimeAr(plannedStart)}` : undefined),
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
        ? 'Indicá demora de 15, 30 o 60 min'
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
      title: isOpsCoverage ? 'Cobertura: listo para fichar' : 'Listo para fichar',
      subtitle: timing.checkInDeadline
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
