/**
 * Fase 7 VPLAN — verificación multi-capa (cobertura + horas SLA).
 */

import { verifyCoverage } from '../../scheduling/autoScheduleEngine';
import { buildEngineContext } from '../vplan.engine-bridge';
import {
  buildVplanCoverageBundle,
  engineAssignmentsFromDraft,
} from '../vplan.coverage-views';
import type { VplanPlanningSnapshot, VplanPlanningState } from '../vplan.firestore';
import type { VplanScheduleDraft, VplanStrategy, VplanVerificationReport } from '../vplan.types';

export function runVplanVerification(opts: {
  snapshot: VplanPlanningSnapshot;
  planningState: VplanPlanningState;
  prevPlanningState: VplanPlanningState;
  strategy: VplanStrategy;
  draft: VplanScheduleDraft;
  monthDemandHours?: number;
}): VplanVerificationReport {
  const ctx = buildEngineContext({
    snapshot: opts.snapshot,
    planningState: opts.planningState,
    prevPlanningState: opts.prevPlanningState,
    strategy: opts.strategy,
  });

  const engineAssignments = engineAssignmentsFromDraft(opts.draft.assignments);
  const coverage = verifyCoverage(ctx, engineAssignments);
  const issues: VplanVerificationReport['issues'] = [];

  if (coverage.uncoveredSlots > 0) {
    issues.push({
      severity: 'blocking',
      code: 'COVERAGE_GAP',
      message: `${coverage.uncoveredSlots} slots sin cubrir (${coverage.coveredSlots}/${coverage.totalSlots})`,
    });
    for (const [dateStr, gaps] of Object.entries(coverage.uncoveredByDay)) {
      for (const g of gaps.slice(0, 5)) {
        issues.push({
          severity: 'blocking',
          code: 'SLOT_MISSING',
          message: `Faltan ${g.missing}×${g.shiftCode} en ${g.positionName}`,
          dateStr,
          positionName: g.positionName,
        });
      }
    }
  }

  const hoursGap = Math.round(coverage.slaVendidas - coverage.billableHours);
  if (coverage.slaVendidas > 0 && hoursGap > 8) {
    issues.push({
      severity: 'warning',
      code: 'HOURS_UNDER_SLA',
      message: `Faltan ~${hoursGap}h facturables vs SLA vendidas`,
    });
  } else if (coverage.slaVendidas > 0 && hoursGap < -8) {
    issues.push({
      severity: 'warning',
      code: 'HOURS_OVER_SLA',
      message: `Exceso ~${Math.abs(hoursGap)}h sobre SLA vendidas`,
    });
  }

  const structuralHours = opts.monthDemandHours ?? 0;
  if (structuralHours > 0 && coverage.slaVendidas > 0) {
    const structGap = Math.round(structuralHours - coverage.slaVendidas);
    if (Math.abs(structGap) > 8) {
      issues.push({
        severity: 'info',
        code: 'STRUCTURE_VS_SLA',
        message: structGap > 0
          ? `Estructura de puestos ~${structGap}h por encima del SLA vendido`
          : `SLA vendido ~${Math.abs(structGap)}h por encima de la estructura`,
      });
    }
  }

  const blocking = issues.filter((i) => i.severity === 'blocking');
  const coverageBundle = buildVplanCoverageBundle({
    ctx,
    draftAssignments: opts.draft.assignments,
    coverage,
    employees: opts.snapshot.employees,
    monthDemandHours: structuralHours,
    defaultPositionByEmp: opts.planningState.defaultPositionByEmp,
    dateStrs: opts.snapshot.days.map((d) => d.dateStr),
  });

  return {
    ok: blocking.length === 0 && coverage.coverageRatio >= 0.98,
    issues,
    billableHours: Math.round(coverage.billableHours),
    slaVendidas: coverage.slaVendidas,
    hoursGap,
    coverage: coverageBundle,
  };
}
