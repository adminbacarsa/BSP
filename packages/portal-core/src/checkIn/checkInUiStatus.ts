import type { Shift } from '@cosp/portal-types';
import type { CheckInTiming } from './portalCheckIn';
import { toDate, formatTimeAr } from '../utils/dates';

export type CheckInUiStatus =
  | 'none'
  | 'too_early'
  | 'ready'
  | 'pending_review'
  | 'rejected'
  | 'present'
  | 'late_notified'
  | 'late_window';

export type CheckInUiStatusView = {
  status: CheckInUiStatus;
  title: string;
  subtitle?: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
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
    const checkInAt = toDate(shift.checkInTime);
    const turnoStart = toDate(shift.startTime) ?? checkInAt;
    if (isOpsCoverage && checkInAt) {
      return {
        status: 'present',
        title: `Presente desde las ${formatTimeAr(checkInAt)}`,
        subtitle: turnoStart
          ? `Turno asignado ${formatTimeAr(turnoStart)} · Cobertura`
          : 'Cobertura confirmada',
        tone: 'success',
      };
    }
    return {
      status: 'present',
      title: turnoStart ? `Tu turno comenzó a las ${formatTimeAr(turnoStart)}` : 'Presente confirmado',
      subtitle: turnoStart ? 'Presente confirmado' : undefined,
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

  if (timing?.tooEarly) {
    return {
      status: 'too_early',
      title: 'Aún no podés fichar',
      subtitle: timing.canNotifyLate
        ? 'Disponible desde 15 min antes · podés avisar llegada tarde'
        : 'Disponible desde 15 min antes del inicio',
      tone: 'neutral',
    };
  }

  if (timing?.lateWindow && !timing.canCheckIn) {
    return {
      status: 'late_window',
      title: timing.canNotifyLate ? 'Podés avisar llegada tarde' : 'Fuera de ventana de fichada',
      subtitle: timing.canNotifyLate
        ? 'Indicá demora de 15, 30 o 60 min'
        : 'Contactá a operaciones si hace falta',
      tone: 'warning',
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

  return { status: 'none', title: '', tone: 'neutral' };
}
