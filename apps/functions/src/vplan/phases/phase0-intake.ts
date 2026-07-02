/**
 * Fase 0 VPLAN — intake y validación de corrida.
 */

import type { VplanIntakeMeta, VplanRunRequest } from '../vplan.types';
import type { VplanPlanningSnapshot } from '../vplan.firestore';

export function buildVplanIntake(
  request: VplanRunRequest,
  snapshot: VplanPlanningSnapshot,
): VplanIntakeMeta {
  return {
    empresaId: request.empresaId,
    objectiveId: request.objectiveId,
    objectiveName: snapshot.objectiveName,
    slaId: snapshot.slaId,
    year: request.year,
    month: request.month,
    mode: request.mode,
    positionCount: snapshot.positions.length,
    employeeCount: snapshot.employees.length,
    monthDays: snapshot.days.length,
    budgetMode: request.budgetMode ?? 'cct',
    preferredCycle: request.preferredCycle ?? '6+2',
  };
}

export function validateVplanRequest(request: VplanRunRequest): string | null {
  if (!request.empresaId?.trim()) return 'empresaId es obligatorio';
  if (!request.objectiveId?.trim()) return 'objectiveId es obligatorio';
  if (!Number.isFinite(request.year) || request.year < 2000) return 'year inválido';
  if (!Number.isFinite(request.month) || request.month < 1 || request.month > 12) return 'month inválido';
  return null;
}
