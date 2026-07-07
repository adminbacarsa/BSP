/**
 * Exportación VPLAN Lab — informe para evaluación (humano / agente IA).
 */

import type { VplanRunResponse } from './vplan.types';

export interface VplanEvalExport {
  exportedAt: string;
  version: string;
  status: VplanRunResponse['status'];
  message: string;
  run: VplanRunResponse['context']['run'];
  intake?: {
    objectiveName?: string;
    employeeCount?: number;
    positionCount?: number;
  };
  pipeline: Array<{ phase: string; ok: boolean; summary: string; durationMs?: number }>;
  strategy?: VplanRunResponse['context']['strategy'];
  feasibility?: VplanRunResponse['context']['feasibility'];
  verification?: {
    ok: boolean;
    billableHours?: number;
    slaVendidas?: number;
    hoursGap?: number;
    coverageRatio?: number;
    blockingCount: number;
    warningCount: number;
    blocking: Array<{
      code: string;
      message: string;
      employeeId?: string;
      employeeName?: string;
      dateStr?: string;
      positionName?: string;
    }>;
    warnings: Array<{ code: string; message: string }>;
    positionSlots?: VplanRunResponse['context']['verification'] extends { coverage?: infer C }
      ? C extends { positionSlots: infer P } ? P : never
      : never;
    gapsByDay?: Record<string, Array<{ positionName: string; shiftCode: string; missing: number }>>;
    coverageAudit?: {
      ok: boolean;
      totalGaps: number;
      totalMissingSlots: number;
      totalExcessSlots: number;
      iterationsUsed?: number;
      gaps: Array<{
        dateStr: string;
        dayLetter: string;
        positionName: string;
        shiftCode: string;
        required: number;
        assigned: number;
        missing: number;
        candidates: Array<{
          employeeId: string;
          displayName?: string;
          currentCode: string;
          canAssign: boolean;
          blockReason?: string;
        }>;
      }>;
    };
  };
  fixerLog?: VplanRunResponse['context']['fixerLog'];
  assignedPositions?: {
    count: number;
    byEmployee: Record<string, string>;
  };
  schedule: Array<{
    employeeId: string;
    displayName: string;
    defaultPosition?: string;
    days: Record<string, { code: string; positionName?: string }>;
    codeTotals: Record<string, number>;
  }>;
  draftStats?: VplanRunResponse['context']['draft'] extends { stats?: infer S } ? S : never;
  deliverableSummary?: string;
}

function resolveEmployeeName(
  employeeId: string,
  nameMap: Map<string, string>,
): string {
  return nameMap.get(employeeId) || employeeId;
}

export function buildVplanEvalExport(
  result: VplanRunResponse,
  nameMap: Map<string, string>,
): VplanEvalExport {
  const ctx = result.context;
  const verification = ctx.verification;
  const cov = verification?.coverage;

  const blocking = (verification?.issues ?? [])
    .filter((i) => i.severity === 'blocking')
    .map((i) => ({
      code: i.code,
      message: i.message,
      employeeId: i.employeeId,
      employeeName: i.employeeId ? resolveEmployeeName(i.employeeId, nameMap) : undefined,
      dateStr: i.dateStr,
      positionName: i.positionName,
    }));

  const warnings = (verification?.issues ?? [])
    .filter((i) => i.severity === 'warning')
    .map((i) => ({ code: i.code, message: i.message }));

  const schedule = (cov?.schedulePreview.rows ?? []).map((row) => ({
    employeeId: row.employeeId,
    displayName: row.displayName || resolveEmployeeName(row.employeeId, nameMap),
    defaultPosition: row.defaultPosition,
    days: Object.fromEntries(
      Object.entries(row.cells).map(([dateStr, cell]) => [
        dateStr,
        { code: cell.code, positionName: cell.positionName },
      ]),
    ),
    codeTotals: row.codeTotals,
  }));

  const assignedByEmployee: Record<string, string> = {};
  for (const row of cov?.schedulePreview.rows ?? []) {
    if (row.defaultPosition) assignedByEmployee[row.employeeId] = row.defaultPosition;
  }

  return {
    exportedAt: new Date().toISOString(),
    version: result.version,
    status: result.status,
    message: result.message,
    run: ctx.run,
    intake: ctx.intake
      ? {
          objectiveName: ctx.intake.objectiveName,
          employeeCount: ctx.intake.employeeCount,
          positionCount: ctx.intake.positionCount,
          prevMonthPreview: ctx.intake.prevMonthPreview,
        }
      : undefined,
    pipeline: ctx.steps.map((s) => ({
      phase: s.phase,
      ok: s.ok,
      summary: s.summary,
      durationMs: s.durationMs,
    })),
    strategy: ctx.strategy,
    feasibility: ctx.feasibility,
    verification: verification
      ? {
          ok: verification.ok,
          billableHours: verification.billableHours,
          slaVendidas: verification.slaVendidas,
          hoursGap: verification.hoursGap,
          coverageRatio: cov?.coverageRatio,
          blockingCount: blocking.length,
          warningCount: warnings.length,
          blocking,
          warnings,
          positionSlots: cov?.positionSlots,
          gapsByDay: cov?.uncoveredByDay,
          coverageAudit: verification.coverageAudit,
        }
      : undefined,
    fixerLog: ctx.fixerLog,
    assignedPositions: Object.keys(assignedByEmployee).length > 0
      ? { count: Object.keys(assignedByEmployee).length, byEmployee: assignedByEmployee }
      : undefined,
    schedule,
    draftStats: ctx.draft?.stats,
    deliverableSummary: ctx.deliverable?.reportSummary,
  };
}

function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportBaseName(result: VplanRunResponse): string {
  const obj = result.context.intake?.objectiveName
    ?.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ]+/g, '_')
    .slice(0, 24) ?? result.context.run.objectiveId.slice(0, 12);
  const { year, month } = result.context.run;
  const mm = String(month).padStart(2, '0');
  return `vplan-${obj}-${year}-${mm}`;
}

export function downloadVplanEvalReport(
  result: VplanRunResponse,
  nameMap: Map<string, string>,
): void {
  const payload = buildVplanEvalExport(result, nameMap);
  const json = JSON.stringify(payload, null, 2);
  downloadBlob(`${exportBaseName(result)}-eval.json`, json, 'application/json;charset=utf-8');
}

export function downloadVplanFullJson(result: VplanRunResponse): void {
  const json = JSON.stringify(result, null, 2);
  downloadBlob(`${exportBaseName(result)}-full.json`, json, 'application/json;charset=utf-8');
}

/** Cronograma en CSV (filas = guardias, columnas = días). */
export function downloadVplanScheduleCsv(
  result: VplanRunResponse,
  nameMap: Map<string, string>,
): void {
  const cov = result.context.verification?.coverage;
  const preview = cov?.schedulePreview;
  if (!preview?.rows.length) return;

  const dates = preview.dateStrs;
  const header = ['empleado', 'id', 'puesto_default', ...dates].join(';');
  const lines = preview.rows.map((row) => {
    const name = row.displayName || resolveEmployeeName(row.employeeId, nameMap);
    const cells = dates.map((d) => row.cells[d]?.code ?? '');
    return [
      `"${name.replace(/"/g, '""')}"`,
      row.employeeId,
      row.defaultPosition ?? '',
      ...cells,
    ].join(';');
  });

  const csv = [header, ...lines].join('\n');
  downloadBlob(`${exportBaseName(result)}-cronograma.csv`, csv, 'text/csv;charset=utf-8');
}
