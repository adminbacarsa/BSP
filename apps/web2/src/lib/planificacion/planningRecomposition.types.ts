/** Paquete de cobertura / liberación planificada (ext + adel split). */

export type RecompositionMode =
  | 'absence'
  | 'liberation'
  | 'anticipated_absence'
  | 'operational_gap'
  | 'early_departure';

export type CoverageSegmentRole = 'EXTENSION' | 'EARLY_START' | 'LIBERATED' | 'TARGET';

export type CoveragePackageType = 'ABSENCE_COVERAGE' | 'LIBERATION_RECOMPOSITION' | 'EARLY_DEPARTURE_COVERAGE';

export interface AnticipatedAbsenceDecl {
  type: string;
  code: string;
  reason: string;
}

export interface PendingAbsenceNovedad {
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  type: string;
  reason: string;
  status: 'APPROVED';
  /** Código corto para liquidación (E, AA, RA…). */
  absenceType?: string;
  codigo?: string;
}

export interface RecompositionSegment {
  employeeId: string;
  role: 'EXTENSION' | 'EARLY_START';
  positionName: string;
  fromTime: string;
  toTime: string;
  homePositionName?: string;
  baseCode?: string;
  /** Horas extra que trabaja el guardia (manual o auto). Se persiste en el shift como extExtraHours. */
  extraHours?: number;
  /** Celda del cronograma donde se aplica la extensión (ej. N del día anterior que cierra en la mañana del hueco). */
  applyDateStr?: string;
}

export interface RecompositionTarget {
  employeeId: string;
  dateStr: string;
  positionName: string;
  code: string;
  label: string;
  /** Ausencia, vacante, titular a liberar o hueco SLA sin persona ausente */
  kind: 'absence' | 'vacancy' | 'working' | 'sla_gap';
}

export interface RecompositionPackage {
  id: string;
  type: CoveragePackageType;
  mode: RecompositionMode;
  objectiveId: string;
  dateStr: string;
  target: RecompositionTarget;
  gapFrom: string;
  gapTo: string;
  gapPositionName: string;
  /** Obligatorio salvo retiro anticipado (solo adelanto). */
  extension?: RecompositionSegment;
  earlyStart: RecompositionSegment;
  liberationReason?: string;
  redeployNote?: string;
  anticipatedAbsence?: AnticipatedAbsenceDecl;
  /** Hora de corte del titular (= inicio del adelanto). */
  earlyDepartureCutTime?: string;
  /** Inicio del turno del titular (retiro anticipado). */
  earlyDepartureStartTime?: string;
}

export interface RecompositionPendingMeta {
  coveragePackageId: string;
  coverageType: CoveragePackageType;
  coverageSegmentRole: CoverageSegmentRole;
  isExtended?: boolean;
  isEarlyStart?: boolean;
  adjustedStartTime?: string;
  adjustedEndTime?: string;
  segmentFromTime?: string;
  segmentToTime?: string;
  coversEmployeeId?: string;
  coversPositionName?: string;
  /** Banda SLA cubierta por el paquete split (ej. MM, M). */
  coversBandCode?: string;
  coverageNote?: string;
  liberationReason?: string;
  redeployNote?: string;
  coveredBy?: string;
  coverageStatus?: 'PARTIAL' | 'COVERED';
  coverageMode?: 'SPLIT' | 'EARLY_DEPARTURE';
  isRetiroAnticipado?: boolean;
}
