/**
 * Fase 10 VPLAN — entrega: diff + reporte (no escribe Firestore en fase prueba).
 */

import type {
  VplanDeliverable,
  VplanScheduleDraft,
  VplanScheduleDiffEntry,
  VplanVerificationReport,
} from '../vplan.types';
import type { VplanExistingAssignment } from '../vplan.firestore';

export function buildVplanDeliverable(opts: {
  draft: VplanScheduleDraft;
  verification: VplanVerificationReport;
  existingAssignments: VplanExistingAssignment[];
  objectiveId: string;
  year: number;
  month: number;
}): VplanDeliverable {
  const existingMap = new Map<string, VplanExistingAssignment>();
  for (const a of opts.existingAssignments) {
    existingMap.set(`${a.employeeId}_${a.dateStr}`, a);
  }

  const diff: VplanScheduleDiffEntry[] = [];

  for (const a of opts.draft.assignments) {
    const key = `${a.employeeId}_${a.dateStr}`;
    const prev = existingMap.get(key);
    if (!prev) {
      diff.push({
        action: 'create',
        employeeId: a.employeeId,
        dateStr: a.dateStr,
        code: a.code,
        positionName: a.positionName,
        hours: a.hours,
      });
    } else if (prev.code !== a.code || prev.positionName !== a.positionName) {
      diff.push({
        action: 'update',
        employeeId: a.employeeId,
        dateStr: a.dateStr,
        code: a.code,
        positionName: a.positionName,
        hours: a.hours,
        previousCode: prev.code,
      });
    }
    existingMap.delete(key);
  }

  for (const [, prev] of existingMap) {
    diff.push({
      action: 'delete',
      employeeId: prev.employeeId,
      dateStr: prev.dateStr,
      code: prev.code,
      positionName: prev.positionName,
      hours: prev.hours,
    });
  }

  const blocking = opts.verification.issues.filter((i) => i.severity === 'blocking').length;
  const reportSummary = [
    `Objetivo ${opts.objectiveId} · ${opts.year}-${String(opts.month).padStart(2, '0')}`,
    `${opts.draft.assignments.length} asignaciones · ${opts.verification.billableHours ?? 0}h facturables`,
    `SLA ${opts.verification.slaVendidas ?? 0}h · gap ${opts.verification.hoursGap ?? 0}h`,
    blocking > 0 ? `${blocking} bloqueante(s) pendiente(s)` : 'Sin bloqueantes de cobertura',
    `Diff: ${diff.filter((d) => d.action === 'create').length} altas · ${diff.filter((d) => d.action === 'update').length} cambios · ${diff.filter((d) => d.action === 'delete').length} bajas`,
  ].join(' · ');

  return {
    diff,
    reportSummary,
    assignmentCount: opts.draft.assignments.length,
    billableHours: opts.verification.billableHours ?? 0,
    uncoveredSlots: blocking,
  };
}
