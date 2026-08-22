import React, { useEffect, useState } from 'react';
import {
  Calculator,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Printer,
} from 'lucide-react';
import type { ProformaExportBundle } from '@/lib/crm/proformaTypes';
import { formatMoney } from '@/lib/crm/proformaFormat';
import { formatHoursColonTotal, shortDayHeader } from '@/lib/crm/proformaGrid';
import type { ProformaDetailMode } from '@/lib/crm/proformaMode';

export type ProformaPanelProps = {
  client: any;
  empresaName?: string;
  proformaMonth: number;
  proformaYear: number;
  proformaStartDate: string;
  proformaEndDate: string;
  proformaDetailMode: ProformaDetailMode;
  proformaBase: 'requested' | 'planned' | 'executed';
  proformaHourlyValue: string;
  proformaTotals: { planned: number; executed: number; sinCobertura: number; loading: boolean };
  proformaBreakdown: any[];
  proformaBundle: ProformaExportBundle | null;
  baseHours: number;
  totalEstimate: number;
  monthsEs: string[];
  expandedKeys: Record<string, boolean>;
  onMonthChange: (m: number) => void;
  onYearChange: (y: number) => void;
  onStartDateChange: (v: string) => void;
  onEndDateChange: (v: string) => void;
  onDetailModeChange: (v: ProformaDetailMode) => void;
  onBaseChange: (v: 'requested' | 'planned' | 'executed') => void;
  onHourlyValueChange: (v: string) => void;
  onRecalculate: () => void;
  onToggleExpanded: (k: string) => void;
  onExportPdf: () => void;
  onExportCsv: () => void;
  onExportExcel: () => void;
  exporting?: boolean;
};

export default function ProformaPanel(props: ProformaPanelProps) {
  const {
    client,
    empresaName,
    proformaMonth,
    proformaYear,
    proformaStartDate,
    proformaEndDate,
    proformaDetailMode,
    proformaBase,
    proformaHourlyValue,
    proformaTotals,
    proformaBreakdown,
    proformaBundle,
    baseHours,
    totalEstimate,
    monthsEs,
    expandedKeys,
    onMonthChange,
    onYearChange,
    onStartDateChange,
    onEndDateChange,
    onDetailModeChange,
    onBaseChange,
    onHourlyValueChange,
    onRecalculate,
    onToggleExpanded,
    onExportPdf,
    onExportCsv,
    onExportExcel,
    exporting,
  } = props;

  const periodLabel = proformaBundle?.periodLabel || `${monthsEs[proformaMonth]?.toUpperCase()}/${proformaYear}`;

  const [openSummary, setOpenSummary] = useState(true);
  const [openGridsSection, setOpenGridsSection] = useState(false);
  const [openBreakdown, setOpenBreakdown] = useState(false);
  const [openEventos, setOpenEventos] = useState(false);
  const [openGrids, setOpenGrids] = useState<Record<string, boolean>>({});
  const [openObjectives, setOpenObjectives] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOpenGrids({});
    setOpenObjectives({});
  }, [proformaBundle?.periodLabel, client?.id]);

  const objectiveCount = proformaBundle?.objectives.length ?? 0;
  const gridOpenCount = Object.values(openGrids).filter(Boolean).length;

  // Mapa objectiveName → stats para el detalle por puesto
  const objectiveStats = React.useMemo(() => {
    const map = new Map<string, { dayHours: number; nightHours: number; guardCount: number }>();
    proformaBundle?.objectives.forEach((g) => {
      map.set(g.objectiveName, {
        dayHours: g.grandTotal.day,
        nightHours: g.grandTotal.night,
        guardCount: g.employees.length,
      });
    });
    return map;
  }, [proformaBundle]);

  const breakdownTotals = React.useMemo(() => {
    let positions = 0, guards = 0, dayHours = 0, nightHours = 0, totalHours = 0;
    proformaBreakdown.forEach((o) => {
      positions += o.positions?.length ?? 0;
      totalHours += o.totalHours ?? 0;
      const st = objectiveStats.get(o.objectiveName);
      if (st) { guards += st.guardCount; dayHours += st.dayHours; nightHours += st.nightHours; }
    });
    return { positions, guards, dayHours, nightHours, totalHours };
  }, [proformaBreakdown, objectiveStats]);

  const toggleGrid = (id: string) => setOpenGrids((prev) => ({ ...prev, [id]: !prev[id] }));
  const expandAllGrids = () => {
    const next: Record<string, boolean> = {};
    proformaBundle?.objectives.forEach((g) => { next[g.objectiveId] = true; });
    setOpenGrids(next);
    setOpenGridsSection(true);
  };
  const collapseAllGrids = () => setOpenGrids({});

  const toggleObjectiveBreakdown = (name: string) => {
    setOpenObjectives((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <div className="space-y-6 w-full max-w-none">
      {/* Encabezado tipo factura */}
      <div className="border-2 border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white">
        <div className="bg-slate-900 text-white px-4 md:px-6 py-4 flex flex-wrap justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Documento interno</p>
            <h3 className="text-2xl font-black uppercase tracking-tight mt-1">Pre-factura</h3>
            <p className="text-sm text-slate-300 mt-1">{periodLabel}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-black uppercase text-[10px] text-slate-400">{empresaName || 'COSP'}</p>
            <p className="font-bold mt-2">Emisión: {new Date().toLocaleDateString('es-AR')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-b border-slate-200">
          <div className="p-6 border-b md:border-b-0 md:border-r border-slate-200">
            <p className="text-[10px] font-black uppercase text-slate-400 mb-2">Cliente</p>
            <p className="text-lg font-black text-slate-800">{client?.name || '—'}</p>
            <p className="text-sm font-bold text-slate-600 mt-1">{client?.legalName || '—'}</p>
            <p className="text-xs text-slate-500 mt-2">CUIT: {client?.taxId || '—'}</p>
            <p className="text-xs text-slate-500">{client?.address || '—'}</p>
            {client?.contactName && <p className="text-xs text-slate-500 mt-1">Contacto: {client.contactName}</p>}
          </div>
          <div className="p-6 bg-slate-50/80">
            <p className="text-[10px] font-black uppercase text-slate-400 mb-3">Importes estimados</p>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 font-bold">Horas base ({proformaBase})</span>
                <span className="font-black text-slate-800">{baseHours} hs</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 font-bold">Valor hora</span>
                <span className="font-black text-slate-800">{formatMoney(Number(proformaHourlyValue) || 0)}</span>
              </div>
              <div className="border-t border-slate-200 pt-2 flex justify-between">
                <span className="font-black text-slate-700 uppercase text-xs">Total estimado</span>
                <span className="text-xl font-black text-indigo-700">{formatMoney(totalEstimate)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Parámetros */}
        <div className="p-6 bg-slate-50 border-b border-slate-200">
          <p className="text-[10px] font-black uppercase text-slate-400 mb-3">Parámetros del período</p>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Año</label>
              <select className="w-full p-2.5 rounded-lg border bg-white text-xs font-bold" value={proformaYear} onChange={(e) => onYearChange(Number(e.target.value))}>
                {[proformaYear - 2, proformaYear - 1, proformaYear, proformaYear + 1].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Mes</label>
              <select className="w-full p-2.5 rounded-lg border bg-white text-xs font-bold" value={proformaMonth} onChange={(e) => onMonthChange(Number(e.target.value))}>
                {monthsEs.map((m, idx) => (
                  <option key={m} value={idx}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Desde</label>
              <input type="date" className="w-full p-2.5 rounded-lg border bg-white text-xs font-bold" value={proformaStartDate} onChange={(e) => onStartDateChange(e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Hasta</label>
              <input type="date" className="w-full p-2.5 rounded-lg border bg-white text-xs font-bold" value={proformaEndDate} onChange={(e) => onEndDateChange(e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Detalle</label>
              <select className="w-full p-2.5 rounded-lg border bg-white text-xs font-bold" value={proformaDetailMode} onChange={(e) => onDetailModeChange(e.target.value as ProformaDetailMode)}>
                <option value="auto">Auto</option>
                <option value="planned">Planificado</option>
                <option value="executed">Ejecutado (fichaje)</option>
                <option value="sin_cobertura">Sin cobertura (ops)</option>
              </select>
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Base horas</label>
              <select className="w-full p-2.5 rounded-lg border bg-white text-xs font-bold" value={proformaBase} onChange={(e) => onBaseChange(e.target.value as any)}>
                <option value="requested">SLA solicitado</option>
                <option value="planned">Planificado</option>
                <option value="executed">Ejecutado</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Valor hora (ARS)</label>
              <input className="w-full p-2.5 rounded-lg border bg-white text-sm font-bold" placeholder="0" value={proformaHourlyValue} onChange={(e) => onHourlyValueChange(e.target.value)} />
            </div>
            <div className="md:col-span-2 flex items-end gap-2 flex-wrap">
              <button type="button" onClick={onRecalculate} className="bg-white border border-slate-300 hover:bg-slate-50 px-4 py-2.5 rounded-lg text-[10px] font-black uppercase flex items-center gap-2">
                <Calculator size={14} /> Recalcular
              </button>
              {proformaTotals.loading && (
                <span className="text-xs font-bold text-slate-400 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Calculando...
                </span>
              )}
              <span className="text-[10px] font-bold text-slate-400">
                {proformaDetailMode === 'sin_cobertura' ? (
                  <>Sin cobertura (ops): {proformaTotals.sinCobertura} hs · huecos declarados en Operaciones</>
                ) : proformaDetailMode === 'executed' ? (
                  <>Ejecutado (fichaje): {proformaTotals.executed} hs · requiere realStart/realEnd del guardia</>
                ) : (
                  <>Plan: {proformaTotals.planned} hs · Ejec: {proformaTotals.executed} hs · Sin cob: {proformaTotals.sinCobertura} hs</>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Export */}
        <div className="px-6 py-4 flex flex-wrap gap-2 bg-white border-b border-slate-100">
          <button
            type="button"
            disabled={!proformaBundle || exporting || proformaTotals.loading}
            onClick={onExportPdf}
            className="bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase flex items-center gap-2"
          >
            <FileText size={14} /> PDF (resumen + por objetivo)
          </button>
          <button
            type="button"
            disabled={!proformaBundle || exporting || proformaTotals.loading}
            onClick={onExportCsv}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase flex items-center gap-2"
          >
            <Download size={14} /> CSV
          </button>
          <button
            type="button"
            disabled={!proformaBundle || exporting || proformaTotals.loading}
            onClick={onExportExcel}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase flex items-center gap-2"
          >
            <FileSpreadsheet size={14} /> Excel
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="bg-white border px-4 py-2 rounded-lg text-[10px] font-black uppercase flex items-center gap-2 text-slate-600 hover:bg-slate-50"
          >
            <Printer size={14} /> Imprimir
          </button>
        </div>
      </div>

      {proformaBundle?.sourceDebug && (
        <p className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 leading-relaxed">
          <span className="font-bold text-slate-600">Fuente pre-factura:</span>{' '}
          cliente <span className="font-mono text-slate-700">{proformaBundle.sourceDebug.clientId}</span>
          {' · '}{proformaBundle.sourceDebug.catalogObjectives} sedes en CRM
          {' · '}{proformaBundle.sourceDebug.turnosLoaded} turnos leídos en el período
          {' · '}{proformaBundle.sourceDebug.turnosEligible} facturables (planificador)
          {' · '}{proformaBundle.sourceDebug.objectiveBlocks} bloques en grilla.
          {' '}Solo turnos de este cliente (clientId + objectiveId de la ficha). Si faltan horas, revisá publicación del crono o objectiveId en Firestore.
        </p>
      )}

      {/* Resumen por objetivo (vista previa export) */}
      {proformaBundle && proformaBundle.summary.length > 0 && (
        <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setOpenSummary((v) => !v)}
            className="w-full px-6 py-3 bg-slate-100 border-b flex items-center justify-between gap-2 text-left hover:bg-slate-200/60 transition-colors"
          >
            <div>
              <p className="text-[10px] font-black uppercase text-slate-500">Resumen por objetivo</p>
              <p className="text-xs font-bold text-slate-400 mt-0.5">{proformaBundle.summary.length} objetivo(s) · vista previa PDF</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-black text-indigo-600 uppercase hidden sm:inline">
                {formatHoursColonTotal(proformaBundle.summary.reduce((a, s) => a + s.totalHours, 0))} hs
              </span>
              {openSummary ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
            </div>
          </button>
          {openSummary && (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-white text-[10px] uppercase">
                  <th className="text-left p-3 font-black">Objetivo</th>
                  <th className="text-right p-3 font-black text-indigo-300">SLA</th>
                  <th className="text-right p-3 font-black">Totales</th>
                  <th className="text-right p-3 font-black">Diurnas</th>
                  <th className="text-right p-3 font-black">Nocturnas</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {proformaBundle.summary.map((s) => (
                  <tr key={s.objectiveName} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-slate-800">{s.objectiveName}</td>
                    <td className="p-3 text-right font-mono font-bold text-indigo-500">
                      {s.slaHours != null ? s.slaHours.toFixed(1) : '—'}
                    </td>
                    <td className="p-3 text-right font-mono font-bold">{s.totalHours.toFixed(1)}</td>
                    <td className="p-3 text-right font-mono text-amber-700">{s.dayHours.toFixed(1)}</td>
                    <td className="p-3 text-right font-mono text-violet-700">{s.nightHours.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {(() => {
                  const totTotal = proformaBundle.summary.reduce((a, s) => a + s.totalHours, 0);
                  const totDay = proformaBundle.summary.reduce((a, s) => a + s.dayHours, 0);
                  const totNight = proformaBundle.summary.reduce((a, s) => a + s.nightHours, 0);
                  const hasSla = proformaBundle.summary.some((s) => s.slaHours != null);
                  const totSla = hasSla ? proformaBundle.summary.reduce((a, s) => a + (s.slaHours ?? 0), 0) : null;
                  return (
                    <tr className="bg-slate-100 text-[10px] font-black uppercase border-t-2 border-slate-300">
                      <td className="p-3 text-slate-600">Subtotal</td>
                      <td className="p-3 text-right font-mono text-indigo-600">
                        {totSla != null ? totSla.toFixed(1) : '—'}
                      </td>
                      <td className="p-3 text-right font-mono text-slate-800">{totTotal.toFixed(1)}</td>
                      <td className="p-3 text-right font-mono text-amber-700">{totDay.toFixed(1)}</td>
                      <td className="p-3 text-right font-mono text-violet-700">{totNight.toFixed(1)}</td>
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* Grilla por objetivo (vista previa PDF) */}
      {proformaBundle && proformaBundle.objectives.length > 0 && (
        <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
          <div className="px-6 py-3 bg-slate-100 border-b flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setOpenGridsSection((v) => !v)}
              className="flex items-center gap-2 text-left hover:opacity-80"
            >
              {openGridsSection ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
              <div>
                <p className="text-[10px] font-black uppercase text-slate-500">Detalle horario por objetivo</p>
                <p className="text-xs font-bold text-slate-400 mt-0.5">
                  {objectiveCount} grilla(s) · {gridOpenCount} expandida(s)
                </p>
              </div>
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={expandAllGrids} className="text-[10px] font-black uppercase text-indigo-600 hover:text-indigo-800 px-2 py-1">
                Expandir todo
              </button>
              <button type="button" onClick={collapseAllGrids} className="text-[10px] font-black uppercase text-slate-400 hover:text-slate-600 px-2 py-1">
                Comprimir todo
              </button>
            </div>
          </div>

          {openGridsSection && (
            <div className="divide-y">
              {proformaBundle.objectives.map((grid) => {
                const isOpen = !!openGrids[grid.objectiveId];
                return (
                  <div key={grid.objectiveId}>
                    <button
                      type="button"
                      onClick={() => toggleGrid(grid.objectiveId)}
                      className="w-full px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-left hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          {isOpen ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
                          <p className="text-sm font-black text-slate-800 uppercase truncate">{grid.objectiveName}</p>
                        </div>
                        {grid.objectiveName.startsWith('Objetivo sin nombre') && (
                          <p
                            className="text-[9px] font-mono text-amber-800 pl-6 truncate max-w-md"
                            title={`Copiar objectiveId para Firestore: ${grid.objectiveId}`}
                          >
                            objectiveId: {grid.objectiveId}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-[10px] font-bold">
                        <span className="text-slate-500">{periodLabel}</span>
                        <span className="font-mono text-slate-700">{formatHoursColonTotal(grid.grandTotal.total)} hs</span>
                        <span className="text-amber-700">{formatHoursColonTotal(grid.grandTotal.day)} D</span>
                        <span className="text-violet-700">{formatHoursColonTotal(grid.grandTotal.night)} N</span>
                        <span className="text-slate-400">{grid.employees.length} guardia(s)</span>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="overflow-x-auto border-t w-full">
                        <table
                          className="w-full table-fixed text-[10px] border-collapse"
                          style={{ minWidth: 200 + 76 + grid.dateColumns.length * 34 }}
                        >
                          <colgroup>
                            <col style={{ width: 200 }} />
                            {grid.dateColumns.map((d) => (
                              <col key={d} />
                            ))}
                            <col style={{ width: 76 }} />
                          </colgroup>
                          <thead>
                            <tr className="bg-slate-50 border-b">
                              <th className="sticky left-0 z-10 bg-slate-50 border-r px-2 py-1.5 text-left font-black text-slate-600">Apellido y nombre/s</th>
                              {grid.dateColumns.map((d) => (
                                <th key={d} className="px-0.5 py-1 text-center font-black text-slate-500 border-r whitespace-nowrap">
                                  <div>{shortDayHeader(d)}</div>
                                  <div className="text-[8px] font-bold text-slate-400">{grid.dayLabels[d]}</div>
                                </th>
                              ))}
                              <th className="px-2 py-1.5 text-center font-black text-slate-600 whitespace-nowrap">Totales</th>
                            </tr>
                          </thead>
                          <tbody>
                            {grid.employees.length === 0 ? (
                              <tr>
                                <td colSpan={grid.dateColumns.length + 2} className="p-4 text-center text-slate-400 font-bold">
                                  Sin turnos en el período
                                </td>
                              </tr>
                            ) : (
                              grid.employees.map((e) => (
                                <tr key={e.employeeId} className="border-b hover:bg-slate-50/50">
                                  <td className="sticky left-0 z-10 bg-white border-r px-2 py-1.5 font-bold text-slate-700 truncate max-w-[200px]" title={e.name}>{e.name}</td>
                                  {grid.dateColumns.map((d) => (
                                    <td key={d} className="px-0.5 py-1 text-center border-r font-mono text-slate-600 whitespace-nowrap">{e.days[d]?.display || ''}</td>
                                  ))}
                                  <td className="px-2 py-1.5 text-center font-mono font-bold whitespace-nowrap">{formatHoursColonTotal(e.totalHours)}</td>
                                </tr>
                              ))
                            )}
                            {(['Totales', 'Diurnas', 'Nocturnas'] as const).map((label, idx) => {
                              const key = idx === 0 ? 'total' : idx === 1 ? 'day' : 'night';
                              const grand = idx === 0 ? grid.grandTotal.total : idx === 1 ? grid.grandTotal.day : grid.grandTotal.night;
                              return (
                                <tr key={label} className="bg-slate-100 font-black border-t-2">
                                  <td className="sticky left-0 z-10 bg-slate-100 border-r px-2 py-1.5">{label}</td>
                                  {grid.dateColumns.map((d) => (
                                    <td key={d} className="px-0.5 py-1 text-center border-r font-mono whitespace-nowrap">
                                      {formatHoursColonTotal(grid.dailyTotals[d]?.[key] || 0)}
                                    </td>
                                  ))}
                                  <td className="px-2 py-1.5 text-center font-mono whitespace-nowrap">{formatHoursColonTotal(grand)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Detalle por objetivo y puesto */}
      <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setOpenBreakdown((v) => !v)}
          className="w-full px-6 py-4 border-b bg-slate-50 flex items-center justify-between gap-2 text-left hover:bg-slate-100 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase text-slate-500">Detalle por objetivo y puesto</p>
            <p className="text-xs font-bold text-slate-400 mt-0.5">
              {proformaBreakdown.length} objetivo(s) · {breakdownTotals.positions} puesto(s) · {breakdownTotals.guards} guardia(s)
            </p>
          </div>
          {proformaBreakdown.length > 0 && (
            <div className="flex items-center gap-3 shrink-0 text-xs font-bold">
              <span className="text-amber-600">{breakdownTotals.dayHours.toFixed(0)} D</span>
              <span className="text-violet-600">{breakdownTotals.nightHours.toFixed(0)} N</span>
              <span className="text-slate-700">{breakdownTotals.totalHours.toFixed(0)} hs</span>
            </div>
          )}
          {openBreakdown ? <ChevronUp size={18} className="text-slate-400 shrink-0" /> : <ChevronDown size={18} className="text-slate-400 shrink-0" />}
        </button>
        {openBreakdown && (
        <div className="p-6 space-y-3">
          {proformaBreakdown.length === 0 ? (
            <p className="text-sm font-bold text-slate-400">Sin turnos en el período seleccionado.</p>
          ) : (
            proformaBreakdown.map((o) => {
              const objOpen = !!openObjectives[o.objectiveName];
              const stats = objectiveStats.get(o.objectiveName);
              return (
              <div key={o.objectiveName} className="border rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleObjectiveBreakdown(o.objectiveName)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 text-left transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {objOpen ? <ChevronUp size={14} className="text-slate-400 shrink-0" /> : <ChevronDown size={14} className="text-slate-400 shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-800 truncate">{o.objectiveName}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">
                        Objetivo · {o.positions.length} puesto(s)
                        {stats && <> · {stats.guardCount} guardia(s)</>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[10px] font-black">
                    {stats && (
                      <>
                        <span className="text-amber-700">{stats.dayHours.toFixed(0)} D</span>
                        <span className="text-violet-700">{stats.nightHours.toFixed(0)} N</span>
                      </>
                    )}
                    <span className="text-slate-700 text-sm">{o.totalHours} hs</span>
                  </div>
                </button>
                {objOpen && (
                <div className="space-y-2 p-3 border-t">
                  {o.positions.map((p: any) => {
                    const key = `${o.objectiveName}__${p.positionName}`;
                    return (
                      <div key={key} className="border rounded-lg overflow-hidden">
                        <button type="button" onClick={() => onToggleExpanded(key)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50">
                          <div className="flex items-center gap-2">
                            {expandedKeys[key] ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />}
                            <div>
                              <p className="text-sm font-black text-slate-800">{p.positionName}</p>
                              <p className="text-[10px] font-bold text-slate-400 uppercase">Puesto</p>
                            </div>
                          </div>
                          <span className="text-sm font-black text-slate-700">{p.totalHours} hs</span>
                        </button>
                        {expandedKeys[key] && (
                          <div className="px-4 pb-3 text-xs font-bold text-slate-500 space-y-1 border-t bg-slate-50/50">
                            {p.byDay.map((d: any) => (
                              <div key={d.date} className="flex justify-between">
                                <span>{d.date}</span>
                                <span>{d.hours} hs</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            );
            })
          )}
        </div>
        )}
      </div>

      {/* Eventos */}
      {proformaBundle?.eventos && proformaBundle.eventos.length > 0 && (
        <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setOpenEventos((v) => !v)}
            className="w-full px-6 py-4 border-b bg-slate-50 flex items-center justify-between gap-2 text-left hover:bg-slate-100 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase text-slate-500">Eventos</p>
              <p className="text-xs font-bold text-slate-400 mt-0.5">
                {proformaBundle.eventos.length} evento(s) ·{' '}
                {proformaBundle.eventos.reduce((a, e) => a + e.servicios.reduce((b, s) => b + s.guardias.length, 0), 0)} guardia(s) ·{' '}
                {proformaBundle.eventos.reduce((a, e) => a + e.totalHoras, 0)} hs
              </p>
            </div>
            {openEventos ? <ChevronUp size={18} className="text-slate-400 shrink-0" /> : <ChevronDown size={18} className="text-slate-400 shrink-0" />}
          </button>
          {openEventos && (
            <div className="p-6 space-y-4">
              {proformaBundle.eventos.map((ev) => {
                const evTotalGuardias = ev.servicios.reduce((a, s) => a + s.guardias.length, 0);
                return (
                  <div key={ev.eventoId} className="border rounded-xl overflow-hidden">
                    {/* Encabezado del evento */}
                    <div className="px-4 py-3 bg-slate-800 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-black text-white">{ev.eventoNombre}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">
                          {ev.servicios.length} servicio(s) · {evTotalGuardias} guardia(s)
                        </p>
                      </div>
                      <span className="text-sm font-black text-amber-400">{ev.totalHoras} hs</span>
                    </div>

                    {/* Servicios */}
                    {ev.servicios.map((srv, sIdx) => {
                      const paxCubierto = srv.guardias.length;
                      const paxReq = srv.cupo ?? '—';
                      const horario = srv.horaInicio && srv.horaFin ? `${srv.horaInicio}–${srv.horaFin}` : null;
                      return (
                        <div key={srv.servicioId} className={sIdx > 0 ? 'border-t' : ''}>
                          {/* Subencabezado servicio */}
                          <div className="px-4 py-2 bg-slate-100 flex flex-wrap items-center gap-x-4 gap-y-0.5">
                            <p className="text-xs font-black text-slate-700">{srv.servicioNombre}</p>
                            <span className="text-[11px] font-bold text-slate-500">{srv.fecha}</span>
                            {horario && <span className="text-[11px] font-bold text-slate-500">{horario}</span>}
                            <span className="text-[11px] font-bold text-slate-500">
                              PAX: <span className={paxCubierto >= Number(srv.cupo ?? 0) && srv.cupo ? 'text-green-600' : 'text-slate-600'}>{paxCubierto}</span>
                              {srv.cupo != null ? ` / ${srv.cupo}` : ''}
                            </span>
                          </div>

                          {/* Tabla guardias */}
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b bg-slate-50/60">
                                <th className="text-left px-4 py-1.5 font-black text-slate-500 uppercase text-[10px]">Guardia</th>
                                <th className="text-right px-4 py-1.5 font-black text-slate-500 uppercase text-[10px]">Hs</th>
                              </tr>
                            </thead>
                            <tbody>
                              {srv.guardias.map((g, i) => (
                                <tr key={`${g.employeeId}-${i}`} className="border-b border-slate-50 hover:bg-slate-50/40">
                                  <td className="px-4 py-1.5 font-bold text-slate-700">{g.name}</td>
                                  <td className="px-4 py-1.5 font-bold text-slate-600 text-right tabular-nums">{g.hours}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-slate-100/80">
                                <td className="px-4 py-1.5 font-black text-slate-600 text-right text-[11px] uppercase">Subtotal</td>
                                <td className="px-4 py-1.5 font-black text-slate-800 text-right tabular-nums">{srv.totalHoras}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      );
                    })}

                    {/* Total evento */}
                    <div className="px-4 py-2 bg-slate-800/10 flex justify-between items-center border-t border-slate-200">
                      <span className="text-xs font-black text-slate-600 uppercase">Total {ev.eventoNombre}</span>
                      <span className="text-sm font-black text-slate-800 tabular-nums">{ev.totalHoras} hs</span>
                    </div>
                  </div>
                );
              })}

              {/* Gran total eventos */}
              {proformaBundle.eventos.length > 1 && (
                <div className="flex justify-between items-center pt-2 border-t border-slate-300">
                  <span className="text-xs font-black text-slate-600 uppercase">Total todos los eventos</span>
                  <span className="text-sm font-black text-slate-800 tabular-nums">
                    {proformaBundle.eventos.reduce((a, e) => a + e.totalHoras, 0)} hs
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
