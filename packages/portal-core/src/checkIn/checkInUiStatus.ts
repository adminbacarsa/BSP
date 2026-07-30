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
    const at = toDate(shift.checkInTime);
    return {
      status: 'present',
      title: 'Presente confirmado',
      subtitle: at ? `Fichada ${formatTimeAr(at)}` : undefined,
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

  if (shift.lateArrivalAt) {
    return {
      status: 'late_notified',
      title: 'Llegada tarde avisada',
      subtitle: 'Operaciones fue notificado',
      tone: 'info',
    };
  }

  if (timing?.tooEarly) {
    return {
      status: 'too_early',
      title: 'Aún no podés fichar',
      subtitle: 'Disponible desde 15 min antes del inicio',
      tone: 'neutral',
    };
  }

  if (timing?.lateWindow) {
    return {
      status: 'late_window',
      title: 'Fuera de ventana de fichada',
      subtitle: 'Podés avisar llegada tarde si venís en camino',
      tone: 'warning',
    };
  }

  if (timing?.canCheckIn) {
    return {
      status: 'ready',
      title: 'Listo para fichar',
      subtitle: 'Usá el botón con GPS en el puesto',
      tone: 'info',
    };
  }

  return { status: 'none', title: '', tone: 'neutral' };
}
