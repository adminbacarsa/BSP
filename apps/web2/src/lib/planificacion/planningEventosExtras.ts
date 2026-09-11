import { isEventosPosition } from '@/lib/servicios/eventosPosition';
import {
  formatShiftClockRange,
  isTuraContiguousToParent,
  turaBillableHours,
} from '@/lib/refuerzo/turaContiguity';

export type PlanningEventosDayEntry = {
  guardName: string;
  hours: number;
  range: string;
  imputation: string;
  contiguous: boolean;
  parentRange?: string;
};

export type PlanningEventosDayCell = {
  totalHours: number;
  entries: PlanningEventosDayEntry[];
};

function resolveTuraDate(tura: Record<string, any>, parent?: Record<string, any> | null): string {
  const fromFecha = String(tura.fecha || '').slice(0, 10);
  if (fromFecha) return fromFecha;
  const start = tura.startTime;
  if (typeof start === 'string' && start.length >= 10) return start.slice(0, 10);
  if (start?.seconds) return new Date(start.seconds * 1000).toISOString().slice(0, 10);
  if (parent?.fecha) return String(parent.fecha).slice(0, 10);
  return '';
}

function findParentShift(
  tura: Record<string, any>,
  shiftsMap: Record<string, any>,
): Record<string, any> | null {
  const parentId = String(tura.parentShiftId || '').trim();
  if (!parentId) return null;
  const direct = Object.values(shiftsMap).find((s) => s?.id === parentId);
  if (direct) return direct;
  for (const row of Object.values(shiftsMap)) {
    if (row?.id === parentId) return row;
  }
  return null;
}

function isEventosImputation(tura: Record<string, any>): boolean {
  const pos = String(tura.positionName || '').trim();
  return isEventosPosition({ name: pos, coverageType: 'eventos' });
}

/** Agrupa TURAs imputadas a Eventos por día del mes visible. */
export function buildPlanningEventosCellsByDay(
  turaMap: Record<string, any>,
  shiftsMap: Record<string, any>,
  objectiveId: string,
  monthPrefix: string,
): Record<string, PlanningEventosDayCell> {
  const out: Record<string, PlanningEventosDayCell> = {};

  for (const tura of Object.values(turaMap)) {
    if (!tura || tura.objectiveId !== objectiveId) continue;
    if (!isEventosImputation(tura)) continue;

    const parent = findParentShift(tura, shiftsMap);
    const dateStr = resolveTuraDate(tura, parent);
    if (!dateStr.startsWith(monthPrefix)) continue;

    const hrs = turaBillableHours(tura);
    if (hrs <= 0) continue;

    const guardName = String(
      tura.parentEmpleadoName
      || tura.employeeName
      || parent?.employeeName
      || 'Guardia',
    ).trim();
    const imputation = String(tura.positionName || 'Eventos').trim();
    const contiguous = parent ? isTuraContiguousToParent(parent, tura) : false;

    out[dateStr] ||= { totalHours: 0, entries: [] };
    out[dateStr].totalHours += hrs;
    out[dateStr].entries.push({
      guardName,
      hours: hrs,
      range: formatShiftClockRange(tura),
      imputation,
      contiguous,
      parentRange: parent ? formatShiftClockRange(parent) : undefined,
    });
  }

  for (const cell of Object.values(out)) {
    cell.entries.sort((a, b) => a.guardName.localeCompare(b.guardName, 'es'));
  }

  return out;
}

export function formatPlanningEventosTooltip(cell: PlanningEventosDayCell): string {
  if (!cell.entries.length) return 'Sin extras Eventos';
  const lines = cell.entries.map((e) => {
    const seg = e.contiguous && e.parentRange
      ? `seguido ${e.parentRange}+${e.range}`
      : e.range || `${e.hours}h`;
    return `• ${e.guardName}: ${seg} (${e.hours}h → ${e.imputation})`;
  });
  return `Eventos · ${cell.totalHours.toFixed(1)}h\n${lines.join('\n')}`;
}
