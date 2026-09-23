/**
 * COSP — Semántica unificada de cobertura (Planificación · Operaciones · RRHH · Supervisión)
 *
 * Tres capas (no intercambiables en UI):
 * - PLAN_ASSIGNED: malla / metadata en `turnos` (coverageStatus, paquete ext+adel, coveredBy…)
 * - OPS_CONFIRMED: CC cerró hueco (operacionallyCovered, origin OPERATIONS_COVERAGE, ausencias GESTIONADA)
 * - OPS_LIVE: puesto con guardia presente en el slot (fichaje — evalúa Operaciones en runtime)
 *
 * Regla transversal: titular ausente con PLAN_ASSIGNED u OPS_CONFIRMED → incidencia RRHH/supervisión,
 * no vacante SLA duplicada; sin presente en slot tras inicio → Ops puede seguir mostrando acción.
 */

import {
  assessSplitPackageStatus,
  type PlanningShiftSlice,
} from '@/lib/planificacion/positionCoverageUnits';
import { isOperationalOriginShift } from '@/lib/planificacion/planningScheduledHours';

export { assessSplitPackageStatus as assessCoveragePackageStatus } from '@/lib/planificacion/positionCoverageUnits';
export type { PlanningShiftSlice } from '@/lib/planificacion/positionCoverageUnits';
export { isOperationalOriginShift } from '@/lib/planificacion/planningScheduledHours';

export type CoberturaRrhhEstado = 'PENDIENTE' | 'GESTIONADA' | 'VACANTE';

export function normalizeCospPositionName(n: unknown): string {
  let s = String(n ?? '').trim().toLowerCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/^puesto\s+/, '');
  return s;
}

/** Matching de puesto objetivo ↔ turno (Plan, Ops, cobertura). */
export function cospPositionMatches(a: unknown, b: unknown): boolean {
  const na = normalizeCospPositionName(a);
  const nb = normalizeCospPositionName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na === 'general' && nb === 'guardia') return true;
  if (nb === 'general' && na === 'guardia') return true;
  return false;
}

/**
 * Cobertura asignada o confirmada sobre el **titular** (doc turno o ausencia vinculada).
 * Usar en: grilla plan (punto teal), RRHH badge, supresión VAC por ausencia, Supervisión.
 */
/** Cierre operativo (Ops/RRHH), no asignación solo planificada. */
export function isTitularOpsCoverageClosed(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) return false;
  const st = String(data.coverageStatus || '').toUpperCase();
  if (st === 'PLANNED' || st === 'PARTIAL') return false;
  if (data.operacionallyCovered === true) return true;
  if (st === 'COVERED') return true;
  const covId = String(data.coverageDocId || '').trim();
  if (covId && (data.operacionallyCovered === true || st === 'COVERED')) return true;
  return false;
}

/**
 * Cobertura asignada o confirmada sobre el titular (Plan teal / tooltip).
 * `PLANNED` y `coveredBy*` sueltos sin cierre Ops no cuentan como cubierto operativo.
 */
export function isTitularCoverageAssigned(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) return false;
  if (isTitularOpsCoverageClosed(data)) return true;
  const st = String(data.coverageStatus || '').toUpperCase();
  if (st === 'PLANNED') return true;
  if (computePlannedOperativelyCovered(data)) return true;
  return false;
}

/**
 * Flags de malla planificada sobre un turno (antes de inferencia Ops por presentes).
 * Espejo de useOperacionesMonitor → plannedOperativelyCovered.
 */
export function computePlannedOperativelyCovered(shift: Record<string, unknown>): boolean {
  if (!shift) return false;
  if (shift.operacionallyCovered === true) return true;
  const isAbsent = shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT';
  const role = String(shift.coverageSegmentRole || '');
  if (
    String(shift.coverageStatus || '').toUpperCase() === 'COVERED'
    && (role === 'TARGET' || isAbsent)
  ) {
    return true;
  }
  if (
    String(shift.coveredBy || '').trim()
    && String(shift.coverageStatus || '').toUpperCase() === 'COVERED'
    && (isAbsent || role === 'TARGET')
  ) {
    return true;
  }
  return false;
}

/** Titular ausente: hueco cerrado a nivel plan/ops-doc (no implica presente en puesto). */
export function isAbsentTitularCoverageClosed(
  shift: Record<string, unknown> | null | undefined,
  packageRows?: PlanningShiftSlice[],
): boolean {
  if (!shift) return false;
  const absent =
    shift.isAbsent === true
    || shift.isPotentialAbsence === true
    || String(shift.status || '').toUpperCase() === 'ABSENT';
  if (!absent) return false;
  if (isTitularOpsCoverageClosed(shift)) return true;
  if (shift.plannedOperativelyCovered === true) return true;
  if (packageRows?.length && assessSplitPackageStatus(packageRows) === 'COVERED') return true;
  const pkgId = String(shift.coveragePackageId || '').trim();
  if (pkgId && packageRows?.length) {
    const siblings = packageRows.filter((r) => String(r.coveragePackageId || '') === pkgId);
    if (siblings.length && assessSplitPackageStatus(siblings) === 'COVERED') return true;
  }
  return false;
}

/** Supervisión / tarjetas Ops: ausente con cobertura registrada. */
export function isShiftOperativelyCovered(
  shift: Record<string, unknown> | null | undefined,
): boolean {
  if (!shift?.isAbsent && String(shift?.status || '').toUpperCase() !== 'ABSENT') return false;
  return isAbsentTitularCoverageClosed(shift);
}

/** Turno de reemplazo creado desde Centro de Comando. */
export function isOpsReplacementShift(shift: Record<string, unknown> | null | undefined): boolean {
  if (!shift || shift.isAbsent || shift.isUnassigned) return false;
  if (String(shift.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE') return true;
  if (shift.absenceShiftId || shift.coveredShiftId) return true;
  if (shift.coversEmployeeId && shift.resolvedBy === 'OPERACIONES') return true;
  return false;
}

/** Estado RRHH alineado con turno titular (ausencias.coberturaEstado). */
/** Doc activo de cobertura CC (no superseded / cancelado). */
export function isActiveOpsCoverageDoc(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  if (String(data.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE') return false;
  if (data.coverageSuperseded === true) return false;
  if (String(data.status || '').toUpperCase() === 'CANCELLED') return false;
  if (data.isDeleted === true) return false;
  return true;
}

/** Turno OPERATIONS_COVERAGE del guardia en el objetivo del cronograma (puede ser 2º doc del día). */
export function pickOpsCoverageShiftForPlanningCell(
  cellTurnos: unknown[] | undefined,
  selectedObjectiveId: string | null | undefined,
): Record<string, unknown> | null {
  const oid = String(selectedObjectiveId || '').trim();
  if (!oid || !cellTurnos?.length) return null;
  for (const raw of cellTurnos) {
    const t = raw as Record<string, unknown>;
    if (!isActiveOpsCoverageDoc(t)) continue;
    if (String(t.objectiveId || '').trim() !== oid) continue;
    return t;
  }
  return null;
}

/**
 * Nombre del guardia que cubre al titular (tooltip plan / RRHH).
 * Busca metadata en titular + turnos OPERATIONS_COVERAGE del día.
 */
export function resolveCoverGuardDisplayName(opts: {
  titularEmpId: string;
  titularShift?: Record<string, unknown> | null;
  dateStr: string;
  cellTurnosMap: Record<string, unknown[] | undefined>;
  empNameById?: (id: string) => string | undefined;
  coveredByFromCell?: string | null;
}): string | null {
  const fromCell = String(opts.coveredByFromCell || '').trim();
  if (fromCell) {
    return fromCell.replace(/\s*\([^)]*\)\s*$/, '').trim() || null;
  }
  const tit = opts.titularShift;
  if (tit && isTitularCoverageAssigned(tit)) {
    const fromName = String(tit.coveredByEmployeeName || tit.coveredBy || '').trim();
    if (fromName) return fromName.replace(/\s*\([^)]*\)\s*$/, '').trim() || fromName;
    const fromId = String(tit.coveredByEmployeeId || '').trim();
    if (fromId && opts.empNameById?.(fromId)) return opts.empNameById(fromId)!;
  }
  const titularId = String(opts.titularEmpId || '').trim();
  const titularShiftId = String(tit?.id || '').trim();
  for (const [mapKey, arr] of Object.entries(opts.cellTurnosMap || {})) {
    if (!mapKey.endsWith(`_${opts.dateStr}`)) continue;
    for (const raw of arr || []) {
      const t = raw as Record<string, unknown>;
      if (!isActiveOpsCoverageDoc(t)) continue;
      if (titularShiftId && String(t.absenceShiftId || t.coveredShiftId || '') === titularShiftId) {
        const n = String(t.employeeName || '').trim()
          || (t.employeeId && opts.empNameById?.(String(t.employeeId))) || '';
        if (n) return n;
      }
      if (titularId && String(t.coversEmployeeId || '') === titularId) {
        const n = String(t.employeeName || '').trim()
          || (t.employeeId && opts.empNameById?.(String(t.employeeId))) || '';
        if (n) return n;
      }
    }
  }
  return null;
}

export function coberturaEstadoFromTitularShift(
  shift: Record<string, unknown> | null | undefined,
): CoberturaRrhhEstado {
  if (!shift) return 'PENDIENTE';
  if (shift.isUnassigned === true || String(shift.employeeId || '') === 'VACANTE') return 'VACANTE';
  const absent =
    shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT';
  if (!absent) return 'PENDIENTE';
  if (isTitularCoverageAssigned(shift)) return 'GESTIONADA';
  return 'PENDIENTE';
}

export function toPlanningShiftSlice(row: Record<string, unknown>): PlanningShiftSlice {
  return {
    code: row.code as string | undefined,
    positionName: row.positionName as string | undefined,
    objectiveId: row.objectiveId as string | undefined,
    coveragePackageId: row.coveragePackageId as string | undefined,
    coverageSegmentRole: row.coverageSegmentRole as string | undefined,
    coverageMode: row.coverageMode as string | undefined,
    coversPositionName: row.coversPositionName as string | undefined,
    coversEmployeeId: row.coversEmployeeId as string | undefined,
    coversBandCode: row.coversBandCode as string | undefined,
    coverageStatus: row.coverageStatus as string | undefined,
    coveredBy: row.coveredBy as string | undefined,
    isExtended: row.isExtended as boolean | undefined,
    isEarlyStart: row.isEarlyStart as boolean | undefined,
    extExtraHours: row.extExtraHours as number | undefined,
  };
}
