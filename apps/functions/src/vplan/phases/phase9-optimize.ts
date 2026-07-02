/**
 * Fase 9 VPLAN — optimización IA opcional (Gemini).
 */

import { runPlanningGeminiOptimize } from '../../assistant/planningGeminiServer';
import type {
  VplanDemandModel,
  VplanOptimizationResult,
  VplanScheduleDraft,
  VplanSupplyModel,
  VplanVerificationReport,
} from '../vplan.types';
import type { VplanPlanningSnapshot } from '../vplan.firestore';

export async function runVplanOptimization(opts: {
  enabled: boolean;
  snapshot: VplanPlanningSnapshot;
  demand: VplanDemandModel;
  supply: VplanSupplyModel;
  draft: VplanScheduleDraft;
  verification: VplanVerificationReport;
}): Promise<{ result: VplanOptimizationResult; draft: VplanScheduleDraft }> {
  if (!opts.enabled) {
    return {
      result: { applied: false, skippedReason: 'runOptimization=false' },
      draft: opts.draft,
    };
  }

  if (opts.verification.ok) {
    return {
      result: { applied: false, skippedReason: 'verificación ya OK' },
      draft: opts.draft,
    };
  }

  if (!process.env.GEMINI_API_KEY) {
    return {
      result: { applied: false, skippedReason: 'GEMINI_API_KEY no configurada en emulador' },
      draft: opts.draft,
    };
  }

  const mes = `${opts.snapshot.days[0]?.dateStr?.slice(0, 7) ?? ''}`;
  const planificacionCompleta: Record<string, unknown> = {};
  for (const a of opts.draft.assignments) {
    planificacionCompleta[`${a.employeeId}_${a.dateStr}`] = {
      code: a.code,
      positionName: a.positionName,
      hours: a.hours,
    };
  }

  const ausencias: Record<string, string[]> = {};
  for (const emp of opts.supply.employees) {
    if (emp.blockedDates.length) ausencias[emp.employeeId] = emp.blockedDates;
  }

  try {
    const gemini = await runPlanningGeminiOptimize({
      mes,
      objetivo: opts.snapshot.objectiveName ?? opts.snapshot.objectiveId,
      slaVendidas: opts.demand.slaVendidas,
      puestos: opts.snapshot.positions,
      empleados: opts.supply.employees.map((e) => ({
        id: e.employeeId,
        nombre: e.displayName,
      })),
      dias: opts.snapshot.days.map((d) => d.dateStr),
      diasBloqueados: [],
      planificacionCompleta,
      ausencias,
      coberturaPorDia: {},
      autoCycles: ['6+2'],
    });

    if (gemini.bloqueoEstructural || !gemini.correcciones?.length) {
      return {
        result: {
          applied: false,
          skippedReason: gemini.razonBloqueo ?? 'sin correcciones',
          summary: gemini.resumen,
        },
        draft: opts.draft,
      };
    }

    const byKey = new Map<string, number>();
    const assignments = [...opts.draft.assignments];
    assignments.forEach((a, i) => byKey.set(`${a.employeeId}_${a.dateStr}`, i));

    let applied = 0;
    for (const c of gemini.correcciones) {
      const key = `${c.empId}_${c.fecha}`;
      const idx = byKey.get(key);
      if (idx === undefined) continue;
      assignments[idx] = {
        ...assignments[idx],
        code: c.codigoNuevo,
        positionName: c.puesto || assignments[idx].positionName,
      };
      applied++;
    }

    return {
      result: {
        applied: applied > 0,
        correctionCount: applied,
        summary: gemini.resumen,
      },
      draft: { ...opts.draft, assignments },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error Gemini';
    return {
      result: { applied: false, skippedReason: msg },
      draft: opts.draft,
    };
  }
}
