import React from 'react';
import {
  Calculator,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Printer,
} from 'lucide-react';
import type { ProformaExportBundle } from '@/lib/crm/proformaTypes';
import { formatMoney } from '@/lib/crm/proformaFormat';
import { formatHoursColonTotal, shortDayHeader } from '@/lib/crm/proformaGrid';

export type ProformaPanelProps = {
  client: any;
  empresaName?: string;
  proformaMonth: number;
  proformaYear: number;
  proformaStartDate: string;
  proformaEndDate: string;
  proformaDetailMode: 'auto' | 'planned' | 'executed';
  proformaBase: 'requested' | 'planned' | 'executed';
  proformaHourlyValue: string;
  proformaTotals: { planned: number; executed: number; loading: boolean };
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
  onDetailModeChange: (v: 'auto' | 'planned' | 'executed') => void;
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

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Encabezado tipo factura */}
      <div className="border-2 border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white">
        <div className="bg-slate-900 text-white px-8 py-6 flex flex-wrap justify-between gap-4">
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
              <select className="w-full p-2.5 rounded-lg border bg-white text-xs font-bold" value={proformaDetailMode} onChange={(e) => onDetailModeChange(e.target.value as any)}>
                <option value="auto">Auto</option>
                <option value="planned">Planificado</option>
                <option value="executed">Ejecutado</option>
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
                Plan: {proformaTotals.planned} hs · Ejec: {proformaTotals.executed} hs
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

      {/* Resumen por objetivo (vista previa export) */}
      {proformaBundle && proformaBundle.summary.length > 0 && (
        <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
          <div className="px-6 py-3 bg-slate-100 border-b">
            <p className="text-[10px] font-black uppercase text-slate-500">Resumen por objetivo (vista previa PDF)</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-white text-[10px] uppercase">
                <th className="text-left p-3 font-black">Objetivo</th>
                <th className="text-right p-3 font-black">Totales</th>
                <th className="text-right p-3 font-black">Diurnas</th>
                <th className="text-right p-3 font-black">Nocturnas</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {proformaBundle.summary.map((s) => (
                <tr key={s.objectiveName} className="hover:bg-slate-50">
                  <td className="p-3 font-bold text-slate-800">{s.objectiveName}</td>
                  <td className="p-3 text-right font-mono font-bold">{s.totalHours.toFixed(1)}</td>
                  <td className="p-3 text-right font-mono text-amber-700">{s.dayHours.toFixed(1)}</td>
                  <td className="p-3 text-right font-mono text-violet-700">{s.nightHours.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Grilla por objetivo (vista previa PDF) */}
      {proformaBundle && proformaBundle.objectives.length > 0 && (
        <div className="space-y-6">
          {proformaBundle.objectives.map((grid) => (
            <div key={grid.objectiveId} className="border rounded-xl overflow-hidden bg-white shadow-sm">
              <div className="px-6 py-3 bg-slate-100 border-b flex flex-wrap justify-between gap-2">
                <p className="text-sm font-black text-slate-800 uppercase">{grid.objectiveName}</p>
                <p className="text-[10px] font-bold text-slate-500">{periodLabel}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] border-collapse min-w-max">
                  <thead>
                    <tr className="bg-slate-50 border-b">
                      <th className="sticky left-0 z-10 bg-slate-50 border-r p-2 text-left font-black text-slate-600">Legajo</th>
                      <th className="sticky left-[72px] z-10 bg-slate-50 border-r p-2 text-left font-black text-slate-600 min-w-[140px]">Apellido y nombre/s</th>
                      {grid.dateColumns.map((d) => (
                        <th key={d} className="p-1 text-center font-black text-slate-500 border-r min-w-[36px]">
                          <div>{shortDayHeader(d)}</div>
                          <div className="text-[8px] font-bold text-slate-400">{grid.dayLabels[d]}</div>
                        </th>
                      ))}
                      <th className="p-2 text-center font-black text-slate-600">Totales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grid.employees.map((e) => (
                      <tr key={e.employeeId} className="border-b hover:bg-slate-50/50">
                        <td className="sticky left-0 z-10 bg-white border-r p-2 font-mono font-bold">{e.legajo}</td>
                        <td className="sticky left-[72px] z-10 bg-white border-r p-2 font-bold text-slate-700">{e.name}</td>
                        {grid.dateColumns.map((d) => (
                          <td key={d} className="p-1 text-center border-r font-mono text-slate-600">{e.days[d]?.display || ''}</td>
                        ))}
                        <td className="p-2 text-center font-mono font-bold">{formatHoursColonTotal(e.totalHours)}</td>
                      </tr>
                    ))}
                    {(['Totales', 'Diurnas', 'Nocturnas'] as const).map((label, idx) => {
                      const key = idx === 0 ? 'total' : idx === 1 ? 'day' : 'night';
                      const grand = idx === 0 ? grid.grandTotal.total : idx === 1 ? grid.grandTotal.day : grid.grandTotal.night;
                      return (
                        <tr key={label} className="bg-slate-100 font-black border-t-2">
                          <td className="sticky left-0 z-10 bg-slate-100 border-r p-2" colSpan={2}>{label}</td>
                          {grid.dateColumns.map((d) => (
                            <td key={d} className="p-1 text-center border-r font-mono">
                              {formatHoursColonTotal(grid.dailyTotals[d]?.[key] || 0)}
                            </td>
                          ))}
                          <td className="p-2 text-center font-mono">{formatHoursColonTotal(grand)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detalle por objetivo y puesto */}
      <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b bg-slate-50">
          <p className="text-[10px] font-black uppercase text-slate-500">Detalle por objetivo y puesto</p>
        </div>
        <div className="p-6 space-y-3">
          {proformaBreakdown.length === 0 ? (
            <p className="text-sm font-bold text-slate-400">Sin turnos en el período seleccionado.</p>
          ) : (
            proformaBreakdown.map((o) => (
              <div key={o.objectiveName} className="border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
                  <div>
                    <p className="text-sm font-black text-slate-800">{o.objectiveName}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Objetivo</p>
                  </div>
                  <div className="text-sm font-black text-slate-700">{o.totalHours} hs</div>
                </div>
                <div className="space-y-2 p-3">
                  {o.positions.map((p: any) => {
                    const key = `${o.objectiveName}__${p.positionName}`;
                    return (
                      <div key={key} className="border rounded-lg overflow-hidden">
                        <button type="button" onClick={() => onToggleExpanded(key)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50">
                          <div>
                            <p className="text-sm font-black text-slate-800">{p.positionName}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Puesto</p>
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
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
