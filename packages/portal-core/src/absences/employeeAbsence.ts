import type { Shift } from '@cosp/portal-types';
import { toDate } from '../utils/dates';

export type AbsenceType =
  | 'Vacaciones'
  | 'Licencia Esp.'
  | 'Enfermedad'
  | 'ART'
  | 'Injustificada';

export const ABSENCE_TYPE_OPTIONS: AbsenceType[] = [
  'Vacaciones',
  'Licencia Esp.',
  'Enfermedad',
  'ART',
  'Injustificada',
];

export type AbsenceCase = 'PROGRAMADA' | 'CORTO_PLAZO' | 'ANTICIPADA';

export type ClassifiedAbsence = {
  absenceCase: AbsenceCase;
  minutesBeforeShift: number | null;
  handledBy: 'PLANNING' | 'OPERATIONS';
  shiftId: string | null;
  objectiveId: string | null;
  objectiveName: string | null;
  positionName: string | null;
  clientId: string | null;
};

export function dateKeyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function classifyAbsenceForEmployee(params: {
  absenceStart: string;
  now?: Date;
  shifts: Shift[];
}): ClassifiedAbsence {
  const nowTime = params.now ?? new Date();
  const todayStr = dateKeyLocal(nowTime);
  let absenceCase: AbsenceCase = 'PROGRAMADA';
  let minutesBeforeShift: number | null = null;
  let handledBy: 'PLANNING' | 'OPERATIONS' = 'PLANNING';
  let shiftId: string | null = null;
  let objectiveId: string | null = null;
  let objectiveName: string | null = null;
  let positionName: string | null = null;
  let clientId: string | null = null;

  if (params.absenceStart !== todayStr) {
    return {
      absenceCase,
      minutesBeforeShift,
      handledBy,
      shiftId,
      objectiveId,
      objectiveName,
      positionName,
      clientId,
    };
  }

  const targetShift = params.shifts.find((s) => {
    const d = toDate(s.startTime);
    return d && dateKeyLocal(d) === todayStr && !s.isFranco;
  });

  if (!targetShift) {
    return {
      absenceCase,
      minutesBeforeShift,
      handledBy,
      shiftId,
      objectiveId,
      objectiveName,
      positionName,
      clientId,
    };
  }

  shiftId = targetShift.id;
  objectiveId = targetShift.objectiveId ?? null;
  objectiveName = targetShift.objectiveName ?? null;
  positionName = targetShift.positionName ?? null;
  clientId = (targetShift as Shift & { clientId?: string }).clientId ?? null;

  const shiftStart = toDate(targetShift.startTime);
  if (!shiftStart) {
    return {
      absenceCase,
      minutesBeforeShift,
      handledBy,
      shiftId,
      objectiveId,
      objectiveName,
      positionName,
      clientId,
    };
  }

  minutesBeforeShift = Math.round((shiftStart.getTime() - nowTime.getTime()) / 60000);
  const isAdminHours = nowTime.getHours() >= 8 && nowTime.getHours() < 20;
  if (minutesBeforeShift < 240) {
    absenceCase = 'CORTO_PLAZO';
    handledBy = 'OPERATIONS';
  } else if (minutesBeforeShift < 480) {
    absenceCase = 'ANTICIPADA';
    handledBy = isAdminHours ? 'PLANNING' : 'OPERATIONS';
  }

  return {
    absenceCase,
    minutesBeforeShift,
    handledBy,
    shiftId,
    objectiveId,
    objectiveName,
    positionName,
    clientId,
  };
}

export function absenceSubmitToastMessage(absenceCase: AbsenceCase): string {
  if (absenceCase === 'CORTO_PLAZO') {
    return 'Aviso urgente enviado — Operaciones fue notificado';
  }
  if (absenceCase === 'ANTICIPADA') {
    return 'Aviso enviado — RRHH y Planificación fueron notificados';
  }
  return 'Solicitud enviada — RRHH revisará tu pedido';
}

export function filterAbsenceTypesForFeatures(opts: {
  reportAbsence: boolean;
  requestLicense: boolean;
}): AbsenceType[] {
  if (opts.reportAbsence && opts.requestLicense) {
    return ABSENCE_TYPE_OPTIONS;
  }
  if (opts.requestLicense) {
    return ['Vacaciones', 'Licencia Esp.'];
  }
  if (opts.reportAbsence) {
    return ['Enfermedad', 'ART', 'Injustificada'];
  }
  return [];
}
