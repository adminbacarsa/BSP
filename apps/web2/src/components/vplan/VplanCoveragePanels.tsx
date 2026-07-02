import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type {
  VplanCoverageBundle,
  VplanScheduleDiffEntry,
  VplanSupplyModel,
  VplanVerificationReport,
} from '@/lib/vplan/vplan.types';

function formatDayHeader(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

function shiftCellClass(code: string): string {
  const c = code.toUpperCase();
  if (['F', 'FF', 'FP'].includes(c)) return 'bg-slate-200 text-slate-600 font-bold';
  if (c === 'FT') return 'bg-amber-100 text-amber-900 font-bold';
  if (c === 'RET') return 'bg-violet-100 text-violet-800 font-bold';
  if (c === 'M' || c === 'D12') return 'bg-sky-100 text-sky-900 font-bold';
  if (c === 'T') return 'bg-orange-100 text-orange-900 font-bold';
  if (c === 'N' || c === 'N12') return 'bg-indigo-100 text-indigo-900 font-bold';
  return 'bg-emerald-50 text-emerald-900 font-bold';
}

function categoryBadge(category: string): string {
  if (category === 'franco') return 'bg-slate-200 text-slate-700';
  if (category === 'ausencia') return 'bg-rose-100 text-rose-800';
  if (category === 'trabajo') return 'bg-emerald-100 text-emerald-800';
  return 'bg-slate-100 text-slate-600';
}

export function buildEmployeeNameMap(supply?: VplanSupplyModel): Map<string, string> {
  const map = new Map<string, string>();
  supply?.employees.forEach((e) => map.set(e.employeeId, e.displayName));
  return map;
}

export function DiffTable({
  rows,
  nameMap,
}: {
  rows: VplanScheduleDiffEntry[];
  nameMap: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const preview = rows.slice(0, 12);
  if (!rows.length) return <p className="text-sm text-slate-500">Sin operaciones en el diff.</p>;

  const label = (r: VplanScheduleDiffEntry) =>
    r.employeeName || nameMap.get(r.employeeId) || r.employeeId;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
      >
        <span className="font-bold text-slate-800">Diff ({rows.length} ops)</span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600 uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Acción</th>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Empleado</th>
              <th className="px-3 py-2 text-left">Código</th>
              <th className="px-3 py-2 text-left">Puesto</th>
            </tr>
          </thead>
          <tbody>
            {(open ? rows : preview).map((r, i) => (
              <tr key={`${r.employeeId}_${r.dateStr}_${i}`} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-mono text-indigo-700">{r.action}</td>
                <td className="px-3 py-1.5">{r.dateStr}</td>
                <td className="px-3 py-1.5 font-medium text-slate-800">{label(r)}</td>
                <td className="px-3 py-1.5 font-bold">{r.code}</td>
                <td className="px-3 py-1.5">{r.positionName || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!open && rows.length > preview.length && (
        <p className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-100">
          Mostrando {preview.length} de {rows.length}. Expandir para ver todo.
        </p>
      )}
    </div>
  );
}

export function VplanCoveragePanels({
  verification,
}: {
  verification: VplanVerificationReport;
}) {
  const cov = verification.coverage;
  const [showGrid, setShowGrid] = useState(true);
  const [showGaps, setShowGaps] = useState(false);

  const francoSummary = useMemo(() => {
    if (!cov?.schedulePreview.codeSummary) return null;
    const francos = cov.schedulePreview.codeSummary.filter((c) => c.category === 'franco');
    const trabajo = cov.schedulePreview.codeSummary.filter((c) => c.category === 'trabajo');
    const francoDays = francos.reduce((s, c) => s + c.count, 0);
    const workDays = trabajo.reduce((s, c) => s + c.count, 0);
    return { francoDays, workDays, francos, trabajo };
  }, [cov]);

  if (!cov) return null;

  const gapDays = Object.keys(cov.uncoveredByDay).sort();

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-500">Cobertura puestos</p>
          <p className="text-lg font-black text-slate-900">{cov.coverageRatio}%</p>
          <p className="text-xs text-slate-600">{cov.coveredSlots}/{cov.totalSlots} slots</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-500">SLA vendidas</p>
          <p className="text-lg font-black text-indigo-700">{verification.slaVendidas ?? 0}h</p>
          <p className="text-xs text-slate-600">Facturables: {verification.billableHours ?? 0}h</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-500">Estructura puestos</p>
          <p className="text-lg font-black text-slate-900">{cov.structuralHours}h</p>
          <p className="text-xs text-slate-600">Demanda mensual SLA</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-500">Turnos / francos</p>
          <p className="text-lg font-black text-slate-900">
            {francoSummary ? `${francoSummary.workDays} / ${francoSummary.francoDays}` : '—'}
          </p>
          <p className="text-xs text-slate-600">días trabajo · días franco</p>
        </div>
      </div>

      {verification.issues.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-1">
          <p className="text-xs font-bold text-slate-800">Issues de verificación</p>
          {verification.issues.map((issue, i) => (
            <p
              key={`${issue.code}_${i}`}
              className={`text-xs rounded-lg px-2 py-1 ${
                issue.severity === 'blocking'
                  ? 'bg-red-50 text-red-800'
                  : issue.severity === 'warning'
                    ? 'bg-amber-50 text-amber-900'
                    : 'bg-slate-50 text-slate-700'
              }`}
            >
              {issue.message}
            </p>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="font-bold text-slate-800 text-sm">Cobertura por puesto y banda (mes)</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Puesto</th>
                <th className="px-3 py-2 text-left">Banda</th>
                <th className="px-3 py-2 text-right">Requeridos</th>
                <th className="px-3 py-2 text-right">Cubiertos</th>
                <th className="px-3 py-2 text-right">Faltan</th>
                <th className="px-3 py-2 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {cov.positionSlots.map((row) => (
                <tr key={`${row.positionName}_${row.shiftCode}`} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 font-medium">{row.positionName}</td>
                  <td className="px-3 py-1.5 font-bold">{row.shiftCode}</td>
                  <td className="px-3 py-1.5 text-right">{row.requiredSlots}</td>
                  <td className="px-3 py-1.5 text-right text-emerald-700">{row.coveredSlots}</td>
                  <td className={`px-3 py-1.5 text-right ${row.missingSlots > 0 ? 'text-red-600 font-bold' : ''}`}>
                    {row.missingSlots}
                  </td>
                  <td className="px-3 py-1.5 text-right">{row.coveragePct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {francoSummary && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="font-bold text-slate-800 text-sm">Resumen de códigos del mes</p>
          </div>
          <div className="flex flex-wrap gap-2 p-3">
            {cov.schedulePreview.codeSummary.map((c) => (
              <span
                key={c.code}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold ${categoryBadge(c.category)}`}
              >
                <span>{c.code}</span>
                <span className="font-normal opacity-80">{c.label}</span>
                <span>×{c.count}</span>
                {c.hours > 0 && <span className="opacity-70">({c.hours}h)</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {gapDays.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50/50 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setShowGaps((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <span className="font-bold text-red-900 text-sm">
              Huecos de cobertura ({gapDays.length} día(s))
            </span>
            {showGaps ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showGaps && (
            <div className="px-4 pb-3 space-y-2 max-h-48 overflow-y-auto">
              {gapDays.map((dateStr) => (
                <div key={dateStr} className="text-xs">
                  <p className="font-bold text-red-800">{dateStr}</p>
                  <ul className="list-disc list-inside text-red-700">
                    {cov.uncoveredByDay[dateStr].map((g, i) => (
                      <li key={i}>
                        {g.positionName}: faltan {g.missing}×{g.shiftCode}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowGrid((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 border-b border-slate-100"
        >
          <span className="font-bold text-slate-800 text-sm">
            Cronograma generado ({cov.schedulePreview.rows.length} guardias)
          </span>
          {showGrid ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        {showGrid && (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="text-[10px] border-collapse min-w-max">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  <th className="sticky left-0 z-20 bg-slate-50 px-2 py-1.5 text-left font-black text-slate-600 border-b border-r border-slate-200 min-w-[140px]">
                    Empleado
                  </th>
                  <th className="px-2 py-1.5 text-left font-black text-slate-500 border-b border-slate-200 min-w-[72px]">
                    Puesto
                  </th>
                  <th className="px-2 py-1.5 text-center font-black text-slate-500 border-b border-slate-200">F</th>
                  {cov.schedulePreview.dateStrs.map((d) => (
                    <th
                      key={d}
                      className="px-1 py-1.5 text-center font-bold text-slate-500 border-b border-slate-200 w-8"
                      title={d}
                    >
                      {formatDayHeader(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cov.schedulePreview.rows.map((row, idx) => {
                  const francoCount = row.codeTotals.F ?? 0;
                  const ffCount = (row.codeTotals.FF ?? 0) + (row.codeTotals.FP ?? 0);
                  return (
                    <tr key={row.employeeId} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                      <td className="sticky left-0 z-10 bg-inherit px-2 py-1 font-medium text-slate-800 border-r border-slate-100 whitespace-nowrap">
                        {row.displayName}
                      </td>
                      <td className="px-2 py-1 text-slate-600 whitespace-nowrap border-r border-slate-100">
                        {row.defaultPosition || '—'}
                      </td>
                      <td className="px-2 py-1 text-center font-bold text-slate-500 border-r border-slate-100">
                        {francoCount + ffCount || '—'}
                      </td>
                      {cov.schedulePreview.dateStrs.map((d) => {
                        const cell = row.cells[d];
                        if (!cell) {
                          return (
                            <td key={d} className="px-0.5 py-0.5 text-center text-slate-300 border-slate-100">
                              ·
                            </td>
                          );
                        }
                        return (
                          <td key={d} className="px-0.5 py-0.5 text-center" title={`${cell.code} · ${cell.positionName || ''}`}>
                            <span className={`inline-block min-w-[1.5rem] rounded px-0.5 ${shiftCellClass(cell.code)}`}>
                              {cell.code}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
