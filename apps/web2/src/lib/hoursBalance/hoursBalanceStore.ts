import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, getDocsOnce } from '@/lib/firebase';
import {
  belongsToEmpresaView,
  empresaCollectionQuery,
  stampEmpresaId,
} from '@/lib/multiempresa';
import { pickVigenteSlasForPeriod, slaHoursForServiceInRange } from '@/lib/crm/slaObjectiveHours';
import { resolveCanonicalObjectiveId } from '@/lib/crm/objectiveIdentity';
import { buildPlanningMonthTurnosQuery, planningMonthBounds } from '@/lib/planificacion/loadPlanningMonthShifts';
import type { SlaPlanningRow } from '@/lib/slaPlanningMatch';
import { buildHoursBalanceMonth, buildObjectiveAliasesFromSla } from './buildHoursBalance';
import {
  HOURS_BALANCE_COLLECTION,
  type HoursBalanceRow,
  type HoursBalanceSource,
  hoursBalanceDocId,
  hoursBalancePeriodKey,
  round1,
} from './types';

const BATCH_LIMIT = 400;
const hoursBalanceMemory = new Map<string, HoursBalanceRow>();

function rememberHoursBalanceRows(rows: HoursBalanceRow[]) {
  for (const row of rows) {
    hoursBalanceMemory.set(
      hoursBalanceDocId(row.empresaId, row.objectiveId, row.year, row.month),
      row,
    );
  }
}

export function peekHoursBalances(opts: {
  empresaId: string;
  periodKeys: string[];
}): HoursBalanceRow[] {
  const emp = String(opts.empresaId || '').trim();
  const keys = new Set(opts.periodKeys.filter(Boolean));
  if (!emp || keys.size === 0) return [];
  const out: HoursBalanceRow[] = [];
  hoursBalanceMemory.forEach((row) => {
    if (row.empresaId === emp && keys.has(row.periodKey)) out.push(row);
  });
  return out;
}

function rowToFirestore(row: HoursBalanceRow) {
  return stampEmpresaId(
    {
      ...row,
      updatedAt: serverTimestamp(),
    } as Record<string, unknown>,
    row.empresaId,
  );
}

export async function persistHoursBalances(rows: HoursBalanceRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let batch = writeBatch(db);
  let ops = 0;
  let written = 0;
  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  };
  for (const row of rows) {
    const id = hoursBalanceDocId(row.empresaId, row.objectiveId, row.year, row.month);
    batch.set(doc(db, HOURS_BALANCE_COLLECTION, id), rowToFirestore(row), { merge: true });
    ops += 1;
    written += 1;
    if (ops >= BATCH_LIMIT) await flush();
  }
  await flush();
  rememberHoursBalanceRows(rows);
  return written;
}

async function fetchHoursBalancesByDocIds(
  empresaId: string,
  periodKeys: string[],
  objectiveIds: string[],
  migracionCompleta: boolean,
): Promise<HoursBalanceRow[]> {
  const emp = String(empresaId || '').trim();
  const oids = [...new Set(objectiveIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!emp || oids.length === 0) return [];
  const ids: string[] = [];
  for (const oid of oids) {
    for (const pk of periodKeys) {
      const [ys, ms] = pk.split('-');
      const year = Number(ys);
      const month = Number(ms);
      if (!year || !month) continue;
      ids.push(hoursBalanceDocId(emp, oid, year, month));
    }
  }
  const out: HoursBalanceRow[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const snaps = await Promise.all(
      ids.slice(i, i + 20).map((id) => getDoc(doc(db, HOURS_BALANCE_COLLECTION, id))),
    );
    snaps.forEach((snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as HoursBalanceRow;
      if (!belongsToEmpresaView(data, emp, migracionCompleta)) return;
      out.push({ ...data, objectiveId: data.objectiveId || snap.id });
    });
  }
  return out;
}

export async function fetchHoursBalances(opts: {
  empresaId: string;
  periodKeys: string[];
  migracionCompleta?: boolean;
  objectiveIds?: string[];
}): Promise<HoursBalanceRow[]> {
  const { empresaId, periodKeys, migracionCompleta = true, objectiveIds } = opts;
  const keys = [...new Set(periodKeys.filter(Boolean))];
  if (keys.length === 0) return [];
  const emp = String(empresaId || '').trim();
  const col = collection(db, HOURS_BALANCE_COLLECTION);
  const out: HoursBalanceRow[] = [];
  const ingest = (data: HoursBalanceRow, id: string) => {
    if (!belongsToEmpresaView(data, emp, migracionCompleta)) return;
    out.push({ ...data, objectiveId: data.objectiveId || id });
  };
  let queryFailed = false;
  for (let i = 0; i < keys.length; i += 10) {
    const chunk = keys.slice(i, i + 10);
    const composite = emp
      ? query(col, where('empresaId', '==', emp), where('periodKey', 'in', chunk))
      : query(col, where('periodKey', 'in', chunk));
    try {
      const snap = await getDocs(composite);
      snap.docs.forEach((d) => ingest(d.data() as HoursBalanceRow, d.id));
    } catch (err) {
      queryFailed = true;
      try {
        const snap = await getDocs(query(col, where('periodKey', 'in', chunk)));
        snap.docs.forEach((d) => ingest(d.data() as HoursBalanceRow, d.id));
        queryFailed = false;
      } catch (err2) {
        console.warn('[hours_balances] query', err2 || err);
      }
    }
  }
  if (out.length === 0 && queryFailed && objectiveIds?.length) {
    const byId = await fetchHoursBalancesByDocIds(emp, keys, objectiveIds, migracionCompleta);
    byId.forEach((row) => out.push(row));
  }
  rememberHoursBalanceRows(out);
  return out;
}

async function loadEmpresaSlas(empresaId: string, scopeEmpresa: boolean): Promise<SlaPlanningRow[]> {
  const snap = await getDocs(
    empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa) as ReturnType<typeof query>,
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as SlaPlanningRow));
}

async function loadMonthTurnos(empresaId: string, year: number, month: number, scopeEmpresa: boolean): Promise<any[]> {
  const q = buildPlanningMonthTurnosQuery({ empresaId, scopeEmpresa, year, month });
  const snap = await getDocsOnce(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function turnoMatchesObjective(t: any, oid: string, aliases: ReturnType<typeof buildObjectiveAliasesFromSla>): boolean {
  const canon = resolveCanonicalObjectiveId(t, aliases) || String(t.objectiveId ?? '').trim();
  return canon === oid || String(t.objectiveId ?? '') === oid;
}

/** Rebuild completo de un objetivo+mes desde turnos (fuente de verdad). */
export async function rebuildHoursBalanceForObjectiveMonth(opts: {
  empresaId: string;
  objectiveId: string;
  year: number;
  month: number;
  scopeEmpresa?: boolean;
  services?: SlaPlanningRow[];
  turnos?: any[];
  rebuiltFrom?: HoursBalanceSource;
}): Promise<HoursBalanceRow | null> {
  const {
    empresaId,
    objectiveId,
    year,
    month,
    scopeEmpresa = true,
    rebuiltFrom = 'planning',
  } = opts;
  const oid = String(objectiveId || '').trim();
  if (!empresaId || !oid) return null;
  const services = opts.services || await loadEmpresaSlas(empresaId, scopeEmpresa);
  const turnos = opts.turnos || await loadMonthTurnos(empresaId, year, month, scopeEmpresa);
  const aliases = buildObjectiveAliasesFromSla(services);
  const monthTurnos = turnos.filter((t) => turnoMatchesObjective(t, oid, aliases));
  const rows = buildHoursBalanceMonth({
    empresaId,
    year,
    month,
    services,
    turnos: monthTurnos,
    rebuiltFrom,
  });
  const row = rows.find((r) => r.objectiveId === oid) || null;
  if (row) {
    await persistHoursBalances([row]);
    return row;
  }
  const empty: HoursBalanceRow = {
    empresaId,
    objectiveId: oid,
    objectiveName: aliases[oid]?.name || oid,
    clientId: String(aliases[oid]?.clientId || '').trim(),
    clientName: '',
    year,
    month,
    periodKey: hoursBalancePeriodKey(year, month),
    slaHours: 0,
    plannedHours: 0,
    vacantHours: 0,
    realHours: 0,
    ftHours: 0,
    extHours: 0,
    adelHours: 0,
    opsHours: 0,
    absenceHours: 0,
    resultante: 0,
    saldoPlan: 0,
    saldoReal: 0,
    rebuiltFrom,
  };
  await persistHoursBalances([empty]);
  return empty;
}

function horizonMonths(): Array<{ year: number; month: number }> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 3, 0);
  const out: Array<{ year: number; month: number }> = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
    out.push({ year: y, month: m + 1 });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/** Al guardar un SLA: actualiza el debe de los meses cercanos. Conserva haber si ya existía. */
export async function patchSlaHoursOnBalances(opts: {
  empresaId: string;
  sla: SlaPlanningRow;
}): Promise<number> {
  const { empresaId, sla } = opts;
  const oid = String(sla.objectiveId || '').trim();
  if (!empresaId || !oid) return 0;

  const aliases = buildObjectiveAliasesFromSla([sla]);
  const canon = resolveCanonicalObjectiveId(sla, aliases) || oid;
  const months = horizonMonths();
  const drafted: HoursBalanceRow[] = months.map(({ year, month }) => {
    const { firstDay, lastDay } = planningMonthBounds(year, month);
    const vigente = pickVigenteSlasForPeriod([sla], firstDay, lastDay);
    const slaHours = round1(
      vigente.reduce((s, srv) => s + slaHoursForServiceInRange(srv, firstDay, lastDay), 0),
    );
    return {
      empresaId,
      objectiveId: canon,
      objectiveName: String(sla.objectiveName || canon),
      clientId: String(sla.clientId || '').trim(),
      clientName: String(sla.clientName || '').trim(),
      year,
      month,
      periodKey: hoursBalancePeriodKey(year, month),
      slaHours,
      plannedHours: 0,
      vacantHours: 0,
      realHours: 0,
      ftHours: 0,
      extHours: 0,
      adelHours: 0,
      opsHours: 0,
      absenceHours: 0,
      resultante: 0,
      saldoPlan: slaHours,
      saldoReal: slaHours,
      rebuiltFrom: 'sla',
    };
  });

  const existing = await fetchHoursBalances({
    empresaId,
    periodKeys: drafted.map((r) => r.periodKey),
  });
  const prevByKey = new Map(
    existing.filter((r) => r.objectiveId === canon).map((r) => [r.periodKey, r]),
  );
  const merged = drafted.map((r) => {
    const prev = prevByKey.get(r.periodKey);
    if (!prev) return r;
    return {
      ...prev,
      slaHours: r.slaHours,
      objectiveName: r.objectiveName || prev.objectiveName,
      clientId: r.clientId || prev.clientId,
      clientName: r.clientName || prev.clientName,
      saldoPlan: round1(r.slaHours - prev.plannedHours),
      saldoReal: round1(r.slaHours - prev.realHours),
      rebuiltFrom: 'sla' as const,
    };
  });
  await persistHoursBalances(merged);
  return merged.length;
}

export async function persistHoursBalancesFromTurnos(opts: {
  empresaId: string;
  services: SlaPlanningRow[];
  turnos: any[];
  months: Array<{ year: number; month: number }>;
  rebuiltFrom?: HoursBalanceSource;
}): Promise<number> {
  const all: HoursBalanceRow[] = [];
  for (const { year, month } of opts.months) {
    const { firstDay, lastDay } = planningMonthBounds(year, month);
    const monthTurnos = opts.turnos.filter((t) => {
      const st = t.startTime?.toDate?.()
        || (t.startTime?.seconds ? new Date(t.startTime.seconds * 1000) : null);
      if (!st) return false;
      return st >= firstDay && st <= lastDay;
    });
    all.push(...buildHoursBalanceMonth({
      empresaId: opts.empresaId,
      year,
      month,
      services: opts.services,
      turnos: monthTurnos,
      rebuiltFrom: opts.rebuiltFrom || 'crm-bootstrap',
    }));
  }
  return persistHoursBalances(all);
}
