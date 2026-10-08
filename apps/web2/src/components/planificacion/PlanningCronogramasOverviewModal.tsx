import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2, ChevronLeft, ChevronRight, Database, ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react';
import {
  CRONOGRAMA_ESTADO_LABEL,
  loadCronogramaOverview,
  type CronogramaEstado,
  type CronogramaOverviewRow,
} from '@/lib/planificacion/planningCronogramaOverview';
import {
  HOURS_LEDGER_PLAN_OPTIONS,
  planHoursOf,
  type HoursLedgerPlanMode,
} from '@/lib/hoursLedger/hoursLedgerRead';
import {
  agrupaPorCliente,
  guardarOrdenCronograma,
  leerOrdenCronograma,
  ordenarFilasCronograma,
  ordenarGruposPorCliente,
  siguienteOrden,
  type ColumnaOrdenCronograma,
  type OrdenCronograma,
} from '@/lib/planificacion/cronogramaOrden';

function formatActivityDate(d: Date | null): string {
  if (!d) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ESTADO_STYLE: Record<CronogramaEstado, string> = {
  PUBLICADO: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  BORRADOR: 'bg-amber-50 text-amber-800 border-amber-200',
  PUBLICADO_CON_CAMBIOS: 'bg-rose-50 text-rose-800 border-rose-200',
  SIN_DATOS: 'bg-slate-100 text-slate-500 border-slate-200',
};

const ESTADO_DOT: Record<CronogramaEstado, string> = {
  PUBLICADO: 'bg-emerald-500',
  BORRADOR: 'bg-amber-500',
  PUBLICADO_CON_CAMBIOS: 'bg-rose-500',
  SIN_DATOS: 'bg-slate-300',
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
  empresaId: string;
  migracionCompleta: boolean;
  scopeEmpresa: boolean;
  clients: { id: string; name?: string; razonSocial?: string; objetivos?: { id?: string; name?: string }[] }[];
  onNavigateToObjective: (clientId: string, objectiveId: string, year: number, month: number) => void;
};

function ThOrden({
  col,
  label,
  orden,
  onOrden,
  align,
  className,
  title,
}: {
  col: ColumnaOrdenCronograma;
  label: string;
  orden: OrdenCronograma | null;
  onOrden: (col: ColumnaOrdenCronograma) => void;
  align: 'left' | 'right' | 'center';
  className: string;
  title?: string;
}) {
  const activa = orden?.columna === col;
  return (
    <th
      aria-sort={activa ? (orden.direccion === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={className}
      title={title}
    >
      <button
        type="button"
        data-ordenar={col}
        onClick={() => onOrden(col)}
        className={`w-full bg-transparent font-black uppercase tracking-wider text-[9px] rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
          align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
        }`}
      >
        {label}
        {activa ? (orden.direccion === 'asc' ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
}

function groupByClient(rows: CronogramaOverviewRow[]) {
  const groups: { clientId: string; clientName: string; rows: CronogramaOverviewRow[] }[] = [];
  const indexByClient = new Map<string, number>();
  for (const row of rows) {
    const idx = indexByClient.get(row.clientId);
    if (idx === undefined) {
      indexByClient.set(row.clientId, groups.length);
      groups.push({ clientId: row.clientId, clientName: row.clientName, rows: [row] });
    } else {
      groups[idx].rows.push(row);
    }
  }
  return groups;
}

export default function PlanningCronogramasOverviewModal({
  isOpen,
  onClose,
  year,
  month,
  onMonthChange,
  empresaId,
  migracionCompleta,
  scopeEmpresa,
  clients,
  onNavigateToObjective,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CronogramaOverviewRow[]>([]);
  const [filterEstado, setFilterEstado] = useState<CronogramaEstado | 'ALL'>('ALL');
  const [filterOpenVacancies, setFilterOpenVacancies] = useState(false);
  const [search, setSearch] = useState('');
  const [planMode, setPlanMode] = useState<HoursLedgerPlanMode>('published');
  const [orden, setOrden] = useState<OrdenCronograma | null>(() => leerOrdenCronograma());

  const monthLabel = useMemo(
    () => new Date(year, month - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
    [year, month],
  );

  const refresh = useCallback(async () => {
    if (!isOpen || !empresaId) return;
    setLoading(true);
    try {
      const data = await loadCronogramaOverview({
        empresaId,
        migracionCompleta,
        scopeEmpresa,
        year,
        month,
        clients,
      });
      setRows(data);
    } catch (e) {
      console.error('[plan] cronograma overview', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isOpen, empresaId, migracionCompleta, scopeEmpresa, year, month, clients]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const s: Record<CronogramaEstado, number> = {
      PUBLICADO: 0,
      BORRADOR: 0,
      PUBLICADO_CON_CAMBIOS: 0,
      SIN_DATOS: 0,
    };
    rows.forEach((r) => { s[r.estado] += 1; });
    return s;
  }, [rows]);

  const totalOpenVacancies = useMemo(() => rows.reduce((acc, r) => acc + (r.openVacancies || 0), 0), [rows]);
  const totalShortRest = useMemo(() => rows.reduce((acc, r) => acc + (r.shortRestGaps || 0), 0), [rows]);
  const objectivesWithOpenVacancies = useMemo(() => rows.filter((r) => r.openVacancies > 0).length, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterEstado !== 'ALL' && r.estado !== filterEstado) return false;
      if (filterOpenVacancies && !r.openVacancies) return false;
      if (!q) return true;
      return (
        r.clientName.toLowerCase().includes(q)
        || r.objectiveName.toLowerCase().includes(q)
        || r.objectiveId.toLowerCase().includes(q)
      );
    });
  }, [rows, filterEstado, filterOpenVacancies, search]);

  const totalPlannedHours = useMemo(
    () => filtered.reduce((acc, r) => acc + planHoursOf(planMode, { planPublished: r.plannedHours, planDraft: r.planDraftHours }), 0),
    [filtered, planMode],
  );
  const portfolioPlannedHours = useMemo(
    () => rows.reduce((acc, r) => acc + planHoursOf(planMode, { planPublished: r.plannedHours, planDraft: r.planDraftHours }), 0),
    [rows, planMode],
  );

  const horasDe = useCallback(
    (r: CronogramaOverviewRow) => planHoursOf(planMode, { planPublished: r.plannedHours, planDraft: r.planDraftHours }),
    [planMode],
  );

  const elegirOrden = (col: ColumnaOrdenCronograma) => {
    setOrden((prev) => {
      const next = siguienteOrden(prev, col);
      guardarOrdenCronograma(next);
      return next;
    });
  };

  const vista = useMemo(() => {
    if (agrupaPorCliente(orden)) {
      const groups = groupByClient(filtered);
      return {
        plana: false as const,
        groups: orden?.columna === 'cliente' ? ordenarGruposPorCliente(groups, orden.direccion) : groups,
      };
    }
    return { plana: true as const, filas: ordenarFilasCronograma(filtered, orden!, horasDe) };
  }, [filtered, orden, horasDe]);

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    onMonthChange(d.getFullYear(), d.getMonth() + 1);
  };

  const celdasObjetivo = (r: CronogramaOverviewRow) => (
    <>
      <td className="px-4 py-2.5 border-r border-slate-100 font-bold text-slate-800">
        <span className="line-clamp-2" title={r.objectiveName}>{r.objectiveName}</span>
      </td>
      <td className="px-4 py-2.5 border-r border-slate-100">
        <span
          className={`inline-flex items-center gap-1.5 text-[9px] font-black px-2.5 py-1 rounded-lg border whitespace-nowrap ${ESTADO_STYLE[r.estado]} ${r.estado === 'PUBLICADO_CON_CAMBIOS' ? 'animate-pulse' : ''}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ESTADO_DOT[r.estado]}`} />
          {CRONOGRAMA_ESTADO_LABEL[r.estado]}
        </span>
      </td>
      <td className="px-4 py-2.5 border-r border-slate-100 text-right font-black tabular-nums text-indigo-700">
        {horasDe(r) > 0 ? (
          <span>{horasDe(r).toLocaleString('es-AR')} hs</span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 border-r border-slate-100 text-right font-mono text-[10px]">
        {r.totalShifts === 0 ? (
          <span className="text-slate-300">—</span>
        ) : (
          <div className="flex flex-col items-end gap-0.5">
            {r.publishedShifts > 0 && (
              <span className="text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                {r.publishedShifts} pub
              </span>
            )}
            {r.draftShifts > 0 && (
              <span className="text-amber-700 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">
                {r.draftShifts} borr
              </span>
            )}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 border-r border-slate-100 text-center">
        {r.openVacancies > 0 ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-black text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-lg">
            <AlertTriangle size={9} />
            {r.openVacancies}
          </span>
        ) : (r.historicoSinCobertura || 0) > 0 ? (
          <span className="text-[10px] font-bold text-slate-400" title="sin cobertura registrada (histórico)">
            {r.historicoSinCobertura}
          </span>
        ) : (
          <span className="text-slate-200 text-[10px]">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 border-r border-slate-100 text-slate-600 text-[10px] font-medium">
        {r.publishedBy ? (
          <span className="line-clamp-2" title={r.publishedBy}>{r.publishedBy}</span>
        ) : r.publishedAt ? (
          <span className="text-slate-500 font-mono text-[9px]">{formatActivityDate(r.publishedAt)}</span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 border-r border-slate-100 text-slate-700 text-[10px] font-mono">
        {r.lastModifiedAt ? (
          <span title={r.lastModifiedAt.toISOString()}>{formatActivityDate(r.lastModifiedAt)}</span>
        ) : (
          <span className="text-slate-300 font-sans">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 border-r border-slate-100 text-slate-600 text-[10px] font-medium">
        {r.lastModifiedBy ? (
          <span className="line-clamp-2" title={r.lastModifiedBy}>{r.lastModifiedBy}</span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="px-2 py-2.5 border-r border-slate-100 text-center">
        {r.shortRestGaps > 0 ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-black text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg"
            title={r.shortRestDetail || 'Descanso menor a 12 h (art. 197 LCT)'}
          >
            <AlertTriangle size={9} />
            {r.shortRestGaps}
          </span>
        ) : (
          <span className="text-slate-200 text-[10px]">—</span>
        )}
      </td>
      <td className="px-2 py-2.5 text-center">
        <button
          type="button"
          title="Abrir en planificador"
          onClick={() => {
            onNavigateToObjective(r.clientId, r.objectiveId, r.year, r.month);
            onClose();
          }}
          className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-100 border border-transparent hover:border-indigo-200 transition-colors"
        >
          <ExternalLink size={14} />
        </button>
      </td>
    </>
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9300] bg-slate-900/55 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl border border-slate-200 flex flex-col h-[min(92vh,900px)] max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white shrink-0">
          <div>
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
              <span className="p-1.5 rounded-xl bg-indigo-100 text-indigo-600 shadow-sm">
                <Database size={16} />
              </span>
              Estado de cronogramas
              <span className="text-[9px] font-black bg-violet-100 text-violet-700 px-2.5 py-0.5 rounded-full normal-case border border-violet-200">
                SuperAdmin
              </span>
            </h3>
            <p className="text-xs font-bold text-slate-500 mt-1 capitalize pl-9">{monthLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 border border-transparent hover:border-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/80 shrink-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="p-2 hover:bg-slate-50 text-slate-600 border-r border-slate-200"
                title="Mes anterior"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="px-3 text-[10px] font-black text-slate-600 uppercase tracking-wide min-w-[100px] text-center capitalize">
                {monthLabel}
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="p-2 hover:bg-slate-50 text-slate-600 border-l border-slate-200"
                title="Mes siguiente"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 flex-1">
              <button
                type="button"
                onClick={() => setFilterEstado('ALL')}
                className={`text-[9px] font-black px-2.5 py-1.5 rounded-lg border transition-colors ${
                  filterEstado === 'ALL'
                    ? 'bg-indigo-600 text-white border-indigo-700 shadow-sm'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                Todos ({rows.length})
              </button>
              <select
                value={planMode}
                onChange={(e) => setPlanMode(e.target.value as HoursLedgerPlanMode)}
                className="text-[9px] font-black px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
              >
                {HOURS_LEDGER_PLAN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {(Object.keys(CRONOGRAMA_ESTADO_LABEL) as CronogramaEstado[]).map((est) => (
                <button
                  key={est}
                  type="button"
                  onClick={() => setFilterEstado(filterEstado === est ? 'ALL' : est)}
                  className={`text-[9px] font-black px-2.5 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
                    filterEstado === est ? ESTADO_STYLE[est] : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ESTADO_DOT[est]}`} />
                  {CRONOGRAMA_ESTADO_LABEL[est]} ({stats[est]})
                </button>
              ))}
              {objectivesWithOpenVacancies > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterOpenVacancies((v) => !v)}
                  className={`text-[9px] font-black px-2.5 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
                    filterOpenVacancies
                      ? 'bg-orange-500 text-white border-orange-600 shadow-sm'
                      : 'bg-orange-50 border-orange-300 text-orange-700 hover:border-orange-400'
                  }`}
                >
                  <AlertTriangle size={10} />
                  Coberturas abiertas ({objectivesWithOpenVacancies})
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente u objetivo…"
              className="flex-1 text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
            />
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-1.5 text-[10px] font-black text-indigo-700 hover:text-indigo-900 disabled:opacity-50 bg-white border border-indigo-200 rounded-xl px-3 py-2 shadow-sm hover:bg-indigo-50 transition-colors"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Actualizar
            </button>
          </div>
        </div>

        {/* Tabla */}
        <div className="flex-1 min-h-0 flex flex-col px-6 py-4 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-400 gap-2 rounded-2xl border border-slate-200 bg-slate-50">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-xs font-bold">Consultando Firestore…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-xs text-slate-400 py-16 rounded-2xl border border-dashed border-slate-200 bg-slate-50">
              Sin objetivos para este filtro.
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto rounded-2xl border border-slate-200 shadow-sm bg-white overscroll-contain">
              <table className="w-full text-[11px] border-collapse min-w-[900px]" data-orden={orden ? `${orden.columna}:${orden.direccion}` : 'agrupado'}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-slate-100 border-b-2 border-slate-200 shadow-sm">
                    <ThOrden col="cliente" label="Cliente" orden={orden} onOrden={elegirOrden} align="left" className="text-left text-[9px] font-black uppercase tracking-wider text-slate-500 px-4 py-3 border-r border-slate-200 w-[16%] bg-slate-100" />
                    <ThOrden col="objetivo" label="Objetivo" orden={orden} onOrden={elegirOrden} align="left" className="text-left text-[9px] font-black uppercase tracking-wider text-slate-500 px-4 py-3 border-r border-slate-200 w-[18%] bg-slate-100" />
                    <ThOrden col="estado" label="Estado" orden={orden} onOrden={elegirOrden} align="left" className="text-left text-[9px] font-black uppercase tracking-wider text-slate-500 px-4 py-3 border-r border-slate-200 w-[16%] bg-slate-100" />
                    <ThOrden col="hs" label="Hs plan" orden={orden} onOrden={elegirOrden} align="right" className="text-right text-[9px] font-black uppercase tracking-wider text-indigo-600 px-4 py-3 border-r border-slate-200 w-[9%] bg-indigo-50/50" />
                    <ThOrden col="turnos" label="Turnos" orden={orden} onOrden={elegirOrden} align="right" className="text-right text-[9px] font-black uppercase tracking-wider text-slate-500 px-4 py-3 border-r border-slate-200 w-[9%] bg-slate-100" />
                    <ThOrden col="coberturas" label="Cob. abiertas" orden={orden} onOrden={elegirOrden} align="center" className="text-center text-[9px] font-black uppercase tracking-wider text-orange-600 px-3 py-3 border-r border-slate-200 w-[8%] bg-orange-50/60" />
                    <ThOrden col="publicado" label="Publicado" orden={orden} onOrden={elegirOrden} align="left" className="text-left text-[9px] font-black uppercase tracking-wider text-slate-500 px-4 py-3 border-r border-slate-200 w-[12%] bg-slate-100" />
                    <ThOrden col="modificacion" label="Últ. modificación" orden={orden} onOrden={elegirOrden} align="left" className="text-left text-[9px] font-black uppercase tracking-wider text-slate-500 px-4 py-3 border-r border-slate-200 w-[12%] bg-slate-100" />
                    <ThOrden col="modificadoPor" label="Modificado por" orden={orden} onOrden={elegirOrden} align="left" className="text-left text-[9px] font-black uppercase tracking-wider text-slate-500 px-4 py-3 border-r border-slate-200 w-[12%] bg-slate-100" />
                    <ThOrden col="descanso" label="Desc. <12h" orden={orden} onOrden={elegirOrden} align="center" className="text-center text-[9px] font-black uppercase tracking-wider text-amber-700 px-2 py-3 border-r border-slate-200 w-[8%] bg-amber-50/70" title="Art. 197 LCT: menos de 12 h entre el fin del turno (planificado, o el real si ya cerró) y el siguiente, también en otro objetivo. No bloquea." />
                    <th className="text-center text-[9px] font-black uppercase tracking-wider text-slate-500 px-2 py-3 w-[4%] bg-slate-100">
                      Ir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vista.plana ? vista.filas.map((r, ri) => (
                    <tr
                      key={r.lookupKey}
                      className={`border-b border-slate-100 hover:bg-indigo-50/40 transition-colors ${ri % 2 === 1 ? 'bg-slate-50/40' : 'bg-white'}`}
                    >
                      <td className="px-4 py-2.5 border-r border-slate-100 font-black text-slate-700 text-[10px] leading-snug">
                        <span className="line-clamp-2" title={r.clientName}>{r.clientName}</span>
                      </td>
                      {celdasObjetivo(r)}
                    </tr>
                  )) : vista.groups.map((group, gi) => (
                    group.rows.map((r, ri) => {
                      const isFirstInGroup = ri === 0;
                      const isLastInGroup = ri === group.rows.length - 1;
                      const isLastGroup = gi === vista.groups.length - 1;
                      const rowBorder = isLastInGroup && !isLastGroup
                        ? 'border-b-2 border-slate-300'
                        : 'border-b border-slate-100';

                      return (
                        <tr
                          key={r.lookupKey}
                          className={`${rowBorder} hover:bg-indigo-50/40 transition-colors ${ri % 2 === 1 ? 'bg-slate-50/40' : 'bg-white'}`}
                        >
                          {isFirstInGroup ? (
                            <td
                              rowSpan={group.rows.length}
                              className="align-top px-4 py-3 border-r border-slate-200 bg-slate-50/70 font-black text-slate-700 text-[10px] leading-snug"
                            >
                              <span className="line-clamp-4" title={group.clientName}>
                                {group.clientName}
                              </span>
                              <span className="block mt-1 text-[9px] font-bold text-slate-400">
                                {group.rows.length} obj.
                              </span>
                            </td>
                          ) : null}
                          {celdasObjetivo(r)}
                        </tr>
                      );
                    })
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <p className="text-[10px] font-black text-slate-600">
                {filtered.length} de {rows.length} objetivo(s) visibles
              </p>
              {totalPlannedHours > 0 && (
                <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-lg tabular-nums">
                  Σ visible: {Math.round(totalPlannedHours).toLocaleString('es-AR')} hs plan cob.
                </span>
              )}
              {portfolioPlannedHours > 0 && filtered.length !== rows.length && (
                <span className="text-[10px] font-bold text-slate-500 tabular-nums">
                  Total mes: {Math.round(portfolioPlannedHours).toLocaleString('es-AR')} hs
                </span>
              )}
              {totalOpenVacancies > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-black text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-lg">
                  <AlertTriangle size={9} />
                  {totalOpenVacancies} ausencia(s) sin cobertura en {objectivesWithOpenVacancies} objetivo(s)
                </span>
              )}
              {totalShortRest > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-black text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg" title="Art. 197 LCT. El mismo par entre dos objetivos se cuenta en los dos.">
                  <AlertTriangle size={9} />
                  {totalShortRest} descanso(s) &lt; 12 h
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-3 text-[9px] font-bold text-slate-500">
              {(Object.keys(CRONOGRAMA_ESTADO_LABEL) as CronogramaEstado[]).map((est) => (
                <span key={est} className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${ESTADO_DOT[est]}`} />
                  {CRONOGRAMA_ESTADO_LABEL[est]}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
