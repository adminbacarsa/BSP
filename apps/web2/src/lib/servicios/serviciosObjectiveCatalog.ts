import type { ServiceSLA } from '@/services/slaService';
import { slaCoversCalendarMonth } from '@/lib/firestoreDates';
import { calculateMonthlyBreakdown, parseYmdToLocalDate } from '@/lib/servicios/slaHoursCalculator';
import {
  filterSlasForPlanningContext,
  isSlaContractActive,
  pickSlaForPlanningMonth,
  planningMonthHasActiveSla,
  type SlaPlanningRow,
} from '@/lib/slaPlanningMatch';

export type ServiciosClientRef = {
  id: string;
  name?: string;
  objectives?: Array<{ id?: string; name?: string }>;
  objetivos?: Array<{ id?: string; name?: string }>;
};

export type ServiciosCatalogRow = {
  key: string;
  clientId: string;
  clientName: string;
  objectiveId: string;
  objectiveName: string;
  hasSlaInMonth: boolean;
  activeSla: (ServiceSLA & { id: string }) | null;
  allSlas: (ServiceSLA & { id: string })[];
};

export type ServiciosCatalogFilter = 'all' | 'with_sla' | 'without_sla';
export type ServiciosCatalogSort = 'alpha' | 'sla_desc' | 'status_active';

export type ServiciosKpiSnapshot = {
  label: string;
  active: number;
  hours: number;
  positions: number;
  guards: number;
};

function normalizeObjectives(client: ServiciosClientRef): Array<{ id: string; name: string }> {
  const raw = client.objectives || client.objetivos || [];
  return raw
    .map((o) => ({
      id: String(o.id ?? '').trim(),
      name: String(o.name ?? '').trim(),
    }))
    .filter((o) => o.id || o.name);
}

export function monthBoundsYmd(year: number, month: number): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    start: `${year}-${pad(month + 1)}-01`,
    end: `${year}-${pad(month + 1)}-${pad(lastDay)}`,
  };
}

export function buildSlasByClientIndex(
  services: (ServiceSLA & { id: string })[],
): Map<string, SlaPlanningRow[]> {
  const map = new Map<string, SlaPlanningRow[]>();
  for (const srv of services) {
    const cid = String(srv.clientId ?? '').trim();
    if (!cid) continue;
    const row = srv as unknown as SlaPlanningRow;
    const bucket = map.get(cid);
    if (bucket) bucket.push(row);
    else map.set(cid, [row]);
  }
  return map;
}

function rowPassesFeatureFilter(
  row: ServiciosCatalogRow,
  featureFilter: 'all' | 'rotaciones' | 'condiciones',
): boolean {
  if (featureFilter === 'all') return true;
  if (!row.hasSlaInMonth || !row.activeSla) return false;
  if (featureFilter === 'rotaciones') {
    return Array.isArray(row.activeSla.serviceRotations) && row.activeSla.serviceRotations.length > 0;
  }
  return Array.isArray(row.activeSla.serviceRules) && row.activeSla.serviceRules.length > 0;
}

export function applyServiciosCatalogFilters(
  rows: ServiciosCatalogRow[],
  opts?: {
    catalogFilter?: ServiciosCatalogFilter;
    featureFilter?: 'all' | 'rotaciones' | 'condiciones';
  },
): ServiciosCatalogRow[] {
  const catalogFilter = opts?.catalogFilter || 'all';
  const featureFilter = opts?.featureFilter || 'all';
  return rows.filter((row) => {
    if (catalogFilter === 'with_sla' && !row.hasSlaInMonth) return false;
    if (catalogFilter === 'without_sla' && row.hasSlaInMonth) return false;
    if (!rowPassesFeatureFilter(row, featureFilter)) return false;
    return true;
  });
}

export function sortServiciosCatalogRows(
  rows: ServiciosCatalogRow[],
  sort: ServiciosCatalogSort,
  getHours: (srv: ServiceSLA & { id: string }) => number,
): ServiciosCatalogRow[] {
  const copy = [...rows];
  if (sort === 'sla_desc') {
    return copy.sort((a, b) => {
      const ha = a.activeSla ? getHours(a.activeSla) : -1;
      const hb = b.activeSla ? getHours(b.activeSla) : -1;
      if (hb !== ha) return hb - ha;
      return a.objectiveName.localeCompare(b.objectiveName, 'es');
    });
  }
  if (sort === 'status_active') {
    return copy.sort((a, b) => {
      const score = (r: ServiciosCatalogRow) => {
        if (!r.hasSlaInMonth) return 2;
        const active = r.allSlas.some((s) => isSlaContractActive(s.status));
        return active ? 0 : 1;
      };
      const d = score(a) - score(b);
      if (d !== 0) return d;
      return a.objectiveName.localeCompare(b.objectiveName, 'es');
    });
  }
  return copy.sort(
    (a, b) =>
      a.objectiveName.localeCompare(b.objectiveName, 'es') ||
      a.clientName.localeCompare(b.clientName, 'es'),
  );
}

export function sortServiciosCatalogClientGroups(
  groups: ServiciosCatalogClientGroup[],
  sort: ServiciosCatalogSort,
): ServiciosCatalogClientGroup[] {
  const copy = groups.map((g) => ({
    ...g,
    rows: [...g.rows],
  }));
  if (sort === 'sla_desc') {
    return copy.sort((a, b) => {
      if (b.totalHoursKpi !== a.totalHoursKpi) return b.totalHoursKpi - a.totalHoursKpi;
      return a.clientName.localeCompare(b.clientName, 'es');
    });
  }
  if (sort === 'status_active') {
    return copy.sort((a, b) => {
      const score = (g: ServiciosCatalogClientGroup) => {
        if (!g.withSla) return 2;
        return g.hasActive ? 0 : 1;
      };
      const d = score(a) - score(b);
      if (d !== 0) return d;
      return a.clientName.localeCompare(b.clientName, 'es');
    });
  }
  return copy.sort((a, b) => a.clientName.localeCompare(b.clientName, 'es'));
}

export function buildServiciosObjectiveCatalog(
  clients: ServiciosClientRef[],
  services: (ServiceSLA & { id: string })[],
  kpiYear: number,
  kpiMonth: number,
  opts?: {
    clientId?: string;
    search?: string;
    slasByClient?: Map<string, SlaPlanningRow[]>;
  },
): ServiciosCatalogRow[] {
  const clientsForPlanning = clients.map((c) => ({
    id: c.id,
    name: c.name,
    objetivos: normalizeObjectives(c).map((o) => ({ id: o.id, name: o.name })),
  }));

  let clientList = clients;
  const filterClientId = String(opts?.clientId ?? '').trim();
  if (filterClientId && filterClientId !== 'all') {
    clientList = clients.filter((c) => c.id === filterClientId);
  }

  const q = (opts?.search || '').toLowerCase().trim();
  const slasByClient = opts?.slasByClient ?? buildSlasByClientIndex(services);
  const allServicesPlanning = services as unknown as SlaPlanningRow[];

  const rows: ServiciosCatalogRow[] = [];

  for (const client of clientList) {
    const clientName = String(client.name || 'Sin cliente').trim();
    const clientPool = slasByClient.get(client.id);
    const planningPool = clientPool && clientPool.length > 0 ? clientPool : allServicesPlanning;

    for (const obj of normalizeObjectives(client)) {
      const objectiveKey = obj.id || `${client.id}_${obj.name}`;
      const objectiveRef = obj.id || obj.name;
      const matchingRows = filterSlasForPlanningContext(
        planningPool,
        client.id,
        objectiveRef,
        clientsForPlanning,
      );
      const matching = matchingRows as unknown as (ServiceSLA & { id: string })[];

      const { vigente } = pickSlaForPlanningMonth(matchingRows, kpiYear, kpiMonth);
      const hasSlaInMonth = planningMonthHasActiveSla(matchingRows, kpiYear, kpiMonth);
      const vigenteSla = vigente ? (vigente as unknown as ServiceSLA & { id: string }) : null;

      if (q) {
        const matchSearch =
          clientName.toLowerCase().includes(q) ||
          obj.name.toLowerCase().includes(q) ||
          obj.id.toLowerCase().includes(q);
        if (!matchSearch) continue;
      }

      rows.push({
        key: objectiveKey,
        clientId: client.id,
        clientName,
        objectiveId: obj.id,
        objectiveName: obj.name || obj.id || 'Sin nombre',
        hasSlaInMonth,
        activeSla: vigenteSla,
        allSlas: [...matching].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')),
      });
    }
  }

  return rows.sort(
    (a, b) =>
      a.clientName.localeCompare(b.clientName, 'es') ||
      a.objectiveName.localeCompare(b.objectiveName, 'es'),
  );
}

export function computeServiciosKpiSnapshot(
  services: (ServiceSLA & { id: string })[],
  year: number,
  month: number,
): ServiciosKpiSnapshot {
  const mStart = new Date(year, month, 1);
  const mEnd = new Date(year, month + 1, 0);
  const sk = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthName = mStart.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
  let active = 0;
  let hours = 0;
  let positions = 0;
  let guards = 0;

  for (const srv of services) {
    if (!srv.startDate) continue;
    const sStart = parseYmdToLocalDate((srv.startDate || '').trim().slice(0, 10));
    const sEnd = srv.endDate
      ? parseYmdToLocalDate((srv.endDate || '').trim().slice(0, 10))
      : new Date(2099, 11, 31);
    if (!sStart || !sEnd || sStart > mEnd || sEnd < mStart) continue;
    active++;
    positions += (srv.positions || []).length;
    (srv.positions || []).forEach((p) => {
      calculateMonthlyBreakdown([p], srv.startDate, srv.endDate, srv.excludedDates).forEach((mb) => {
        if (mb.monthKey === sk) {
          const pax = p.quantity || 1;
          const minRot = p.coverageType === '24hs' ? pax * 2 : pax;
          guards += Math.max(minRot, Math.ceil(mb.totalHours / 200));
        }
      });
    });
    calculateMonthlyBreakdown(srv.positions, srv.startDate, srv.endDate, srv.excludedDates).forEach((mb) => {
      if (mb.monthKey === sk) hours += mb.totalHours;
    });
  }

  return {
    label: monthName.charAt(0).toUpperCase() + monthName.slice(1),
    active,
    hours: Math.round(hours),
    positions,
    guards,
  };
}

export type ServiciosCatalogClientGroup = {
  clientId: string;
  clientName: string;
  rows: ServiciosCatalogRow[];
  withSla: number;
  withoutSla: number;
  totalHoursKpi: number;
  totalPositions: number;
  hasActive: boolean;
};

export function buildServiciosCatalogClientGroups(
  catalog: ServiciosCatalogRow[],
  getHours: (srv: ServiceSLA & { id: string }) => number,
  sort: ServiciosCatalogSort = 'alpha',
): ServiciosCatalogClientGroup[] {
  const map = new Map<string, ServiciosCatalogClientGroup>();

  for (const row of catalog) {
    let group = map.get(row.clientId);
    if (!group) {
      group = {
        clientId: row.clientId,
        clientName: row.clientName,
        rows: [],
        withSla: 0,
        withoutSla: 0,
        totalHoursKpi: 0,
        totalPositions: 0,
        hasActive: false,
      };
      map.set(row.clientId, group);
    }
    group.rows.push(row);
    if (row.hasSlaInMonth) {
      group.withSla += 1;
      group.hasActive = true;
      const srv = row.activeSla;
      if (srv) {
        group.totalHoursKpi += getHours(srv);
        group.totalPositions += (srv.positions || []).reduce((s, p) => s + (p.quantity || 1), 0);
      }
    } else {
      group.withoutSla += 1;
    }
  }

  const groups = [...map.values()].map((g) => ({
    ...g,
    rows: sortServiciosCatalogRows(g.rows, sort, getHours),
  }));
  return sortServiciosCatalogClientGroups(groups, sort);
}

/** @deprecated Usar hasSlaInMonth del catálogo — helper para filas legacy */
export function slaCoversKpiMonth(
  srv: ServiceSLA,
  kpiYear: number,
  kpiMonth: number,
): boolean {
  return slaCoversCalendarMonth(srv.startDate, srv.endDate, kpiYear, kpiMonth);
}
