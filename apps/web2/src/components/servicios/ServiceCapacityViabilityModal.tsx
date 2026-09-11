'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Gauge,
  ClipboardList,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import type { ServiceSLA } from '@/services/slaService';
import { db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';
import { novedadTypeService } from '@/services/novedadTypeService';
import type { NovedadType } from '@/lib/rrhh/novedadTypes';
import {
  buildServiceCapacityViability,
  employeeBelongsToObjective,
  isActiveEmployeeStatus,
  monthBounds,
  prevCalendarMonth,
  type CapacityEmployeeInput,
  type ServiceCapacityViability,
} from '@/lib/servicios/serviceCapacityViability';
import {
  buildServiceObjectiveMonthReport,
  formatBandCounts,
  type ServiceObjectiveMonthReport,
} from '@/lib/servicios/serviceObjectiveMonthReport';

export interface ServiceCapacityViabilityModalProps {
  open: boolean;
  onClose: () => void;
  service: (ServiceSLA & { id: string }) | null;
  empresaId: string | null | undefined;
  /** Preferidos ya cargados (opcional); si faltan se cargan al abrir. */
  preferredEmployees?: CapacityEmployeeInput[];
  initialYear?: number;
  /** 0–11 */
  initialMonth?: number;
}

type TabId = 'capacidad' | 'informe';

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function fmtHs(n: number) {
  return `${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })} h`;
}

function lostHoursTone(hs: number) {
  if (hs <= 0) return 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40';
  if (hs < 40) return 'text-amber-800 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/40';
  return 'text-rose-800 bg-rose-50 dark:text-rose-200 dark:bg-rose-950/40';
}

function BarRow({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,7.5rem)_1fr_4.5rem] gap-2 items-center text-[11px] font-bold text-slate-600 dark:text-slate-300">
      <span className="truncate">{label}</span>
      <div className="h-5 rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="tabular-nums text-right text-slate-800 dark:text-slate-100">{fmtHs(value)}</span>
    </div>
  );
}

async function loadPreferredByField(
  empresaId: string,
  fieldValue: string,
): Promise<CapacityEmployeeInput[]> {
  if (!fieldValue) return [];
  try {
    const snap = await getDocs(
      query(
        collection(db, 'empleados'),
        where('empresaId', '==', empresaId),
        where('preferredObjectiveId', '==', fieldValue),
      ),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as CapacityEmployeeInput);
  } catch {
    return [];
  }
}

async function loadEmpresaEmployees(empresaId: string): Promise<CapacityEmployeeInput[]> {
  const snap = await getDocs(
    query(collection(db, 'empleados'), where('empresaId', '==', empresaId)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as CapacityEmployeeInput);
}

function mergeEmployeesById(...lists: CapacityEmployeeInput[][]): CapacityEmployeeInput[] {
  const map = new Map<string, CapacityEmployeeInput>();
  for (const list of lists) {
    for (const e of list) {
      if (!e?.id) continue;
      if (!map.has(e.id)) map.set(e.id, e);
    }
  }
  return [...map.values()].filter((e) => isActiveEmployeeStatus(e.status));
}

/**
 * Plantilla del servicio: preferidos (objetivo o id SLA), dotación,
 * positionAssignments del SLA y quienes aparecen en la malla del mes.
 */
async function loadServicePlantilla(opts: {
  empresaId: string;
  objectiveId: string;
  serviceId: string;
  assignmentIds: string[];
  mallaEmpIds: string[];
  seed?: CapacityEmployeeInput[];
}): Promise<CapacityEmployeeInput[]> {
  const { empresaId, objectiveId, serviceId } = opts;
  const [byObj, bySla] = await Promise.all([
    loadPreferredByField(empresaId, objectiveId),
    loadPreferredByField(empresaId, serviceId),
  ]);

  let merged = mergeEmployeesById(opts.seed || [], byObj, bySla);

  const needScan =
    merged.length === 0 ||
    opts.assignmentIds.some((id) => !merged.some((e) => e.id === id)) ||
    opts.mallaEmpIds.some((id) => !merged.some((e) => e.id === id));

  if (needScan) {
    const all = await loadEmpresaEmployees(empresaId);
    const extraIds = new Set(
      [...opts.assignmentIds, ...opts.mallaEmpIds].map((x) => String(x || '').trim()).filter(Boolean),
    );
    const matched = all.filter(
      (e) =>
        isActiveEmployeeStatus(e.status) &&
        (employeeBelongsToObjective(e, objectiveId, serviceId) || extraIds.has(e.id)),
    );
    merged = mergeEmployeesById(merged, matched);
  }

  return merged;
}

async function loadTurnosForObjectiveMonth(
  empresaId: string,
  objectiveId: string,
  year: number,
  month: number,
): Promise<any[]> {
  const { start, end } = monthBounds(year, month);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const inMonth = (t: any) => {
    const raw = t.startTime;
    let ms: number | null = null;
    if (raw?.toDate) ms = raw.toDate().getTime();
    else if (typeof raw?.seconds === 'number') ms = raw.seconds * 1000;
    else if (typeof raw === 'string' || raw instanceof Date) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) ms = d.getTime();
    }
    if (ms == null) {
      const sk = String(t.scheduleDate || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(sk)) {
        const [y, m, d] = sk.split('-').map(Number);
        ms = new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
      }
    }
    return ms != null && ms >= start.getTime() && ms <= end.getTime();
  };

  const mapDocs = (snap: { docs: Array<{ id: string; data: () => any }> }) =>
    snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  try {
    const snap = await getDocs(
      query(
        collection(db, 'turnos'),
        where('empresaId', '==', empresaId),
        where('objectiveId', '==', objectiveId),
        where('startTime', '>=', Timestamp.fromDate(start)),
        where('startTime', '<=', Timestamp.fromDate(end)),
      ),
    );
    const rows = mapDocs(snap);
    if (rows.length) return rows;
  } catch {
    /* fallback abajo */
  }

  try {
    const snap = await getDocs(
      query(
        collection(db, 'turnos'),
        where('objectiveId', '==', objectiveId),
        where('startTime', '>=', Timestamp.fromDate(start)),
        where('startTime', '<=', Timestamp.fromDate(end)),
      ),
    );
    const rows = mapDocs(snap).filter(
      (t) => !empresaId || String((t as any).empresaId || '') === empresaId,
    );
    if (rows.length) return rows;
  } catch {
    /* fallback abajo */
  }

  try {
    const snap = await getDocs(
      query(collection(db, 'turnos'), where('objectiveId', '==', objectiveId)),
    );
    return mapDocs(snap).filter(
      (t) =>
        (!empresaId || String((t as any).empresaId || '') === empresaId) &&
        inMonth(t),
    );
  } catch {
    try {
      const snap = await getDocs(
        query(
          collection(db, 'turnos'),
          where('objectiveId', '==', objectiveId),
          where('startTime', '>=', startIso),
          where('startTime', '<=', endIso),
        ),
      );
      return mapDocs(snap).filter(
        (t) => !empresaId || String((t as any).empresaId || '') === empresaId,
      );
    } catch {
      return [];
    }
  }
}

async function loadAusenciasForEmps(
  empresaId: string,
  empIds: Set<string>,
  fromYmd: string,
  toYmd: string,
): Promise<any[]> {
  if (!empIds.size) return [];
  try {
    const snap = await getDocs(
      query(collection(db, 'ausencias'), where('empresaId', '==', empresaId)),
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => {
        const eid = String((a as any).employeeId || '');
        if (!empIds.has(eid)) return false;
        const s = String((a as any).startDate || '').slice(0, 10);
        const e = String((a as any).endDate || s).slice(0, 10);
        if (!s) return false;
        return s <= toYmd && e >= fromYmd;
      });
  } catch {
    return [];
  }
}

/** @deprecated usar loadAusenciasForEmps */
async function loadAusenciasPrev(
  empresaId: string,
  empIds: Set<string>,
  year: number,
  month: number,
): Promise<any[]> {
  const { end } = monthBounds(year, month);
  const startKey = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  return loadAusenciasForEmps(empresaId, empIds, startKey, endKey);
}

export function ServiceCapacityViabilityModal({
  open,
  onClose,
  service,
  empresaId,
  preferredEmployees,
  initialYear,
  initialMonth,
}: ServiceCapacityViabilityModalProps) {
  const now = new Date();
  const [tab, setTab] = useState<TabId>('capacidad');
  const [year, setYear] = useState(initialYear ?? now.getFullYear());
  const [month, setMonth] = useState(initialMonth ?? now.getMonth());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emps, setEmps] = useState<CapacityEmployeeInput[]>([]);
  const [turnosMes, setTurnosMes] = useState<any[]>([]);
  const [turnosPrev, setTurnosPrev] = useState<any[]>([]);
  const [ausenciasPrev, setAusenciasPrev] = useState<any[]>([]);
  const [ausenciasVac, setAusenciasVac] = useState<any[]>([]);
  const [tiposNovedad, setTiposNovedad] = useState<NovedadType[]>([]);

  useEffect(() => {
    if (!open || !service) return;
    const y = initialYear ?? now.getFullYear();
    const m = initialMonth ?? now.getMonth();
    setYear(y);
    setMonth(m);
    setTab('capacidad');
  }, [open, service?.id]);

  useEffect(() => {
    if (!open || !service || !empresaId) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const oid = String(service.objectiveId || '').trim();
        const sid = String(service.id || '').trim();
        const assignmentIds = (service.positionAssignments || [])
          .map((a) => String(a.employeeId || '').trim())
          .filter(Boolean);

        const prev = prevCalendarMonth(year, month);
        const [tm, tp] = await Promise.all([
          oid ? loadTurnosForObjectiveMonth(empresaId, oid, year, month) : Promise.resolve([] as any[]),
          oid ? loadTurnosForObjectiveMonth(empresaId, oid, prev.year, prev.month) : Promise.resolve([] as any[]),
        ]);
        if (cancelled) return;

        const mallaEmpIds = [
          ...new Set(
            [...tm, ...tp]
              .map((t) => String(t.employeeId || '').trim())
              .filter((id) => id && id.toUpperCase() !== 'VACANTE'),
          ),
        ];

        const seed = (preferredEmployees || []).filter((e) =>
          isActiveEmployeeStatus(e.status) &&
          (employeeBelongsToObjective(e, oid, sid) || mallaEmpIds.includes(e.id) || assignmentIds.includes(e.id)),
        );

        const employees =
          oid || sid
            ? await loadServicePlantilla({
                empresaId,
                objectiveId: oid,
                serviceId: sid,
                assignmentIds,
                mallaEmpIds,
                seed,
              })
            : seed;

        if (cancelled) return;
        const empIds = new Set(employees.map((e) => e.id));
        const daysInMes = new Date(year, month + 1, 0).getDate();
        const ytdFrom = `${year}-01-01`;
        const ytdTo = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMes).padStart(2, '0')}`;
        const [ausPrev, ausVac, tipos] = await Promise.all([
          loadAusenciasPrev(empresaId, empIds, prev.year, prev.month),
          loadAusenciasForEmps(empresaId, empIds, ytdFrom, ytdTo),
          novedadTypeService.listByEmpresa(empresaId).catch(() => [] as NovedadType[]),
        ]);
        if (cancelled) return;
        setEmps(employees);
        setTurnosMes(tm);
        setTurnosPrev(tp);
        setAusenciasPrev(ausPrev);
        setAusenciasVac(ausVac);
        setTiposNovedad(tipos);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'No se pudo cargar el estudio');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open, service?.id, service?.objectiveId, empresaId, year, month, preferredEmployees]);

  const capacity: ServiceCapacityViability | null = useMemo(() => {
    if (!service) return null;
    return buildServiceCapacityViability({
      service,
      employees: emps,
      year,
      month,
      ausenciasPrev,
      ausenciasVac,
      turnosPrev,
      turnosMes,
      tiposNovedad,
      employeesAlreadyResolved: true,
    });
  }, [service, emps, year, month, ausenciasPrev, ausenciasVac, turnosPrev, turnosMes, tiposNovedad]);

  const report: ServiceObjectiveMonthReport | null = useMemo(() => {
    if (!service) return null;
    return buildServiceObjectiveMonthReport({
      service,
      turnos: turnosMes,
      employees: emps,
      year,
      month,
    });
  }, [service, turnosMes, emps, year, month]);

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  if (!open || !service) return null;

  const maxBarCap = Math.max(
    capacity?.slaHsMonth || 0,
    capacity?.capacityBrutaHs || 0,
    capacity?.capacityNetHs || 0,
    1,
  );
  const maxBarInf = Math.max(report?.slaHs || 0, report?.planHs || 0, report?.realHs || 0, 1);

  return (
    <div className="fixed inset-0 z-[9000] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
              Viabilidad del servicio
            </p>
            <h2 className="text-lg font-black text-slate-900 dark:text-white truncate">
              {service.objectiveName || service.clientName || 'Servicio'}
            </h2>
            <p className="text-[11px] font-bold text-slate-500">
              Contrato {String(service.startDate || '').slice(0, 10)} → {String(service.endDate || '').slice(0, 10)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/50 px-1 py-1">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="p-1.5 rounded-xl hover:bg-white dark:hover:bg-slate-800 text-slate-500"
                aria-label="Mes anterior"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-[11px] font-black uppercase tabular-nums min-w-[4.5rem] text-center text-slate-700 dark:text-slate-200">
                {MONTHS[month]} {year}
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="p-1.5 rounded-xl hover:bg-white dark:hover:bg-slate-800 text-slate-500"
                aria-label="Mes siguiente"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="px-5 pt-3 flex gap-2">
          {(
            [
              { id: 'capacidad' as const, label: 'Capacidad', icon: Gauge },
              { id: 'informe' as const, label: 'Informe mes', icon: ClipboardList },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl text-[11px] font-black uppercase tracking-wide transition ${
                  active
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200/80'
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm font-bold">
              <Loader2 className="animate-spin" size={18} />
              Cargando datos COSP…
            </div>
          )}
          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm font-bold">
              {error}
            </div>
          )}

          {!loading && !error && tab === 'capacidad' && capacity && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-950/40 p-3 shadow-sm">
                  <p className="text-[9px] font-black uppercase text-slate-500">Hs SLA</p>
                  <p className="text-2xl font-black tabular-nums text-indigo-600 dark:text-indigo-400">{fmtHs(capacity.slaHsMonth)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-950/40 p-3 shadow-sm">
                  <p className="text-[9px] font-black uppercase text-slate-500">Capacidad neta</p>
                  <p className="text-2xl font-black tabular-nums text-emerald-600 dark:text-emerald-400">{fmtHs(capacity.capacityNetHs)}</p>
                </div>
                <div className={`rounded-2xl border border-slate-200 dark:border-slate-700 p-3 shadow-sm ${lostHoursTone(capacity.horasPerdidas)}`}>
                  <p className="text-[9px] font-black uppercase opacity-70">Hs perdidas</p>
                  <p className="text-2xl font-black tabular-nums">{fmtHs(capacity.horasPerdidas)}</p>
                  <p className="text-[9px] font-bold opacity-60 mt-0.5">
                    {capacity.horasPerdidas > 0
                      ? 'SLA − neta'
                      : capacity.holguraHs > 0
                        ? `Holgura +${fmtHs(capacity.holguraHs)}`
                        : 'Paquete cubierto'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-950/40 p-3 shadow-sm">
                  <p className="text-[9px] font-black uppercase text-slate-500">Plantilla / aus. ant.</p>
                  <p className="text-2xl font-black tabular-nums text-slate-800 dark:text-slate-100">
                    {capacity.plantilla}
                    <span className="text-sm font-bold text-slate-500 ml-1">
                      · {capacity.ausentismo.modo === 'sin_indice' ? 's/índice' : `${capacity.ausentismo.indicePct}%`}
                    </span>
                  </p>
                  <p className="text-[9px] font-bold text-slate-400 mt-0.5">
                    {capacity.coverageProfile.label} · tope {capacity.weeklyCapHs} h/sem
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border-l-4 border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30 px-4 py-3 text-[12px] font-bold text-slate-700 dark:text-slate-200 shadow-sm">
                {capacity.conclusion}
                {capacity.ausentismo.modo === 'sin_indice' && (
                  <span className="block mt-1 text-slate-500 font-semibold">
                    Sin historial de ausencias (sin V) en el mes anterior — no se descuenta índice.
                  </span>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm space-y-2">
                <p className="text-[9px] font-black uppercase text-slate-500 tracking-wide">
                  Oferta vs paquete (techo {capacity.techoHs} h · {capacity.weeklyCapHs} h/sem · {capacity.coverageProfile.label})
                </p>
                <BarRow label="SLA mes" value={capacity.slaHsMonth} max={maxBarCap} color="#4f46e5" />
                <BarRow label="Bruta (CCT+obj)" value={capacity.capacityBrutaHs} max={maxBarCap} color="#64748b" />
                <BarRow label="Tras V cobrada" value={capacity.capacityAfterVacHs} max={maxBarCap} color="#f59e0b" />
                <BarRow label="Neta (−aus)" value={capacity.capacityNetHs} max={maxBarCap} color="#10b981" />
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950/50 border-b border-slate-100 dark:border-slate-800">
                  <p className="text-[9px] font-black uppercase text-slate-500">Guardias — capacidad del mes</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                    Pend. se reparte hasta el 31/12 · VAC cobrada = max(V del mes, cuota del pendiente) · neta aplica índice aus. mes ant. sin V
                  </p>
                </div>
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-[11px]">
                    <thead className="text-slate-500 font-black uppercase sticky top-0 bg-white dark:bg-slate-900">
                      <tr>
                        <th className="text-left px-3 py-2">Guardia</th>
                        <th className="text-right px-2 py-2">Ant.</th>
                        <th className="text-right px-2 py-2">Der.</th>
                        <th className="text-right px-2 py-2">Tom.</th>
                        <th className="text-right px-2 py-2">Pend.</th>
                        <th className="text-left px-2 py-2">Turno</th>
                        <th className="text-right px-2 py-2">Esquema</th>
                        <th className="text-right px-2 py-2">VAC cob.</th>
                        <th className="text-right px-3 py-2">Neta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {capacity.guards.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-3 py-8 text-center text-slate-400 font-bold">
                            Sin plantilla ACTIVE vinculada (preferido / dotación / malla)
                          </td>
                        </tr>
                      ) : (
                        capacity.guards.map((g) => (
                          <tr key={g.employeeId} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-3 py-2 font-bold text-slate-800 dark:text-slate-100">{g.name}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{g.yearsSeniority}a</td>
                            <td className="px-2 py-2 text-right tabular-nums">{g.vacationDaysYear}d</td>
                            <td className="px-2 py-2 text-right tabular-nums">{g.vacationDaysTakenYtd}d</td>
                            <td className="px-2 py-2 text-right tabular-nums font-black text-indigo-600 dark:text-indigo-400">
                              {g.vacationDaysPending}d
                            </td>
                            <td className="px-2 py-2 font-black text-indigo-600 dark:text-indigo-400">
                              {g.tipificado ? g.shiftCode : '—'}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">{fmtHs(g.schemeHsMonth)}</td>
                            <td className="px-2 py-2 text-right tabular-nums" title={`V mes ${g.vacationDaysInMonth}d · reserva ${g.vacationDaysReserveMonth}d`}>
                              {g.vacationDaysCharged > 0
                                ? `${g.vacationDaysCharged}d / ${fmtHs(g.vacationHsMonth)}`
                                : '0'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-black">{fmtHs(g.netHs)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {capacity.shiftMix.length > 0 && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
                  <p className="text-[9px] font-black uppercase text-slate-500 mb-2">Tipología de turno (dotación)</p>
                  <div className="flex flex-wrap gap-2">
                    {capacity.shiftMix.map((m) => (
                      <span
                        key={m.code}
                        className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-[11px] font-black text-slate-700 dark:text-slate-200"
                      >
                        {m.code}
                        <span className="tabular-nums text-indigo-600 dark:text-indigo-400">{m.guards}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {!loading && !error && tab === 'informe' && report && (
            <>
              {report.callouts.length > 0 && (
                <div className="rounded-2xl border-l-4 border-amber-500 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-3 text-[12px] font-bold text-slate-700 dark:text-slate-200 space-y-1 shadow-sm">
                  <p className="inline-flex items-center gap-1.5 text-amber-800 dark:text-amber-200">
                    <AlertTriangle size={14} /> Brechas detectadas (COSP)
                  </p>
                  {report.callouts.map((c, i) => (
                    <p key={i}>{c}</p>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-950/40 p-3 shadow-sm">
                  <p className="text-[9px] font-black uppercase text-slate-500">SLA</p>
                  <p className="text-2xl font-black tabular-nums text-indigo-600">{fmtHs(report.slaHs)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-950/40 p-3 shadow-sm">
                  <p className="text-[9px] font-black uppercase text-slate-500">Plan malla</p>
                  <p className="text-2xl font-black tabular-nums text-emerald-600">{fmtHs(report.planHs)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-950/40 p-3 shadow-sm">
                  <p className="text-[9px] font-black uppercase text-slate-500">Fichadas</p>
                  <p className="text-2xl font-black tabular-nums text-sky-600">{fmtHs(report.realHs)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-950/40 p-3 shadow-sm">
                  <p className="text-[9px] font-black uppercase text-slate-500">Días desvío</p>
                  <p className="text-2xl font-black tabular-nums text-rose-600">{report.diasIncompletos}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm space-y-2">
                <p className="text-[9px] font-black uppercase text-slate-500 tracking-wide">Comparativa de horas (COSP)</p>
                <BarRow label="Hs SLA" value={report.slaHs} max={maxBarInf} color="#4f46e5" />
                <BarRow label="Plan malla" value={report.planHs} max={maxBarInf} color="#10b981" />
                <BarRow label="Fichadas" value={report.realHs} max={maxBarInf} color="#0ea5e9" />
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
                <p className="text-[9px] font-black uppercase text-slate-500 mb-1">Cobertura diaria (plan vs fichadas)</p>
                <p className="text-[10px] font-bold text-slate-400 mb-3">
                  Verde = bandas fichadas coinciden con plan · Rojo = desvío
                </p>
                <div className="grid grid-cols-7 gap-1.5">
                  {report.calendario.map((d) => (
                    <div
                      key={d.fecha}
                      className={`rounded-xl p-1.5 text-center min-h-[4.25rem] ${
                        d.ok
                          ? 'bg-emerald-50 dark:bg-emerald-950/40'
                          : 'bg-rose-50 dark:bg-rose-950/40'
                      }`}
                      title={`${d.fecha} plan ${formatBandCounts(d.planCounts)} · real ${formatBandCounts(d.realCounts)}`}
                    >
                      <div className="text-[11px] font-black text-slate-800 dark:text-slate-100">{d.dia}</div>
                      <div className={`text-[8px] font-black leading-tight ${d.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {formatBandCounts(d.realCounts)}
                      </div>
                      <div className="text-[8px] font-bold text-slate-400 tabular-nums">{d.realHs}h</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                  <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950/50 border-b border-slate-100 dark:border-slate-800">
                    <p className="text-[9px] font-black uppercase text-slate-500">
                      Desvíos vs plan ({report.desvios.length})
                    </p>
                  </div>
                  <div className="overflow-auto max-h-64">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-slate-500 font-black uppercase">
                          <th className="text-left px-3 py-2">Fecha</th>
                          <th className="text-left px-2 py-2">Plan</th>
                          <th className="text-left px-2 py-2">Real</th>
                          <th className="text-right px-3 py-2">Hs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.desvios.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-3 py-6 text-center text-slate-400 font-bold">
                              Sin desvíos
                            </td>
                          </tr>
                        ) : (
                          report.desvios.map((r) => (
                            <tr key={r.fecha} className="border-t border-slate-100 dark:border-slate-800">
                              <td className="px-3 py-2 font-bold">
                                {r.fecha.slice(8)} ({r.diaSem})
                              </td>
                              <td className="px-2 py-2">{formatBandCounts(r.plan)}</td>
                              <td className="px-2 py-2">{formatBandCounts(r.real)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{r.real.hs}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                  <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950/50 border-b border-slate-100 dark:border-slate-800">
                    <p className="text-[9px] font-black uppercase text-slate-500">Guardias del mes</p>
                  </div>
                  <div className="overflow-auto max-h-64">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-slate-500 font-black uppercase">
                          <th className="text-left px-3 py-2">Nombre</th>
                          <th className="text-right px-2 py-2">Plan</th>
                          <th className="text-right px-2 py-2">Real</th>
                          <th className="text-left px-3 py-2">Bandas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.guardias.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-3 py-6 text-center text-slate-400 font-bold">
                              Sin turnos en malla/fichadas
                            </td>
                          </tr>
                        ) : (
                          report.guardias.map((g) => (
                            <tr key={g.employeeId} className="border-t border-slate-100 dark:border-slate-800">
                              <td className="px-3 py-2 font-bold">
                                {g.name}
                                {g.overTecho200 && (
                                  <span className="ml-1 text-[9px] font-black text-amber-600">+200</span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">{fmtHs(g.hsPlan)}</td>
                              <td className="px-2 py-2 text-right tabular-nums">{fmtHs(g.hsReal)}</td>
                              <td className="px-3 py-2">{formatBandCounts(g.bandas)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {report.outliers.length > 0 && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                  <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950/50 border-b border-slate-100 dark:border-slate-800">
                    <p className="text-[9px] font-black uppercase text-slate-500">
                      Observaciones de fichada ({report.outliers.length})
                    </p>
                  </div>
                  <div className="overflow-auto max-h-48">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-slate-500 font-black uppercase">
                          <th className="text-left px-3 py-2">Fecha</th>
                          <th className="text-left px-2 py-2">Guardia</th>
                          <th className="text-right px-2 py-2">Bruto</th>
                          <th className="text-right px-2 py-2">COSP</th>
                          <th className="text-left px-3 py-2">Nota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.outliers.map((o, i) => (
                          <tr key={`${o.fecha}_${o.employeeId}_${i}`} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-3 py-2">{o.fecha}</td>
                            <td className="px-2 py-2 font-bold">{o.name}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-rose-600">{fmtHs(o.hsReportadas)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-emerald-600">{fmtHs(o.hsUsadas)}</td>
                            <td className="px-3 py-2 text-amber-700 dark:text-amber-300">{o.nota}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
