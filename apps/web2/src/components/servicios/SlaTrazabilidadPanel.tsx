import React, { useMemo, useState } from 'react';
import { FileText, ChevronDown, Download } from 'lucide-react';
import type { ServiceSLA } from '@/services/slaService';
import type { SolicitudRefuerzo } from '@/services/solicitudRefuerzoService';
import {
  buildServiceModificaciones,
  filterModificacionesForMonth,
  formatModificacionFechaAr,
  monthRangeForService,
  type SlaModificacionRow,
} from '@/lib/servicios/slaModificaciones';
import { exportSlaTrazabilidadPdf } from '@/lib/servicios/exportSlaTrazabilidadPdf';

const KIND_STYLES: Record<SlaModificacionRow['kind'], string> = {
  LOG: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  RFZ: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  TURA: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  ESTRUCTURAL: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  TURNO: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
};

type TurnoExtra = Parameters<typeof buildServiceModificaciones>[2][number];

export type SlaTrazabilidadPanelProps = {
  service: ServiceSLA & { id?: string };
  solicitudes: SolicitudRefuerzo[];
  turnos: TurnoExtra[];
  kpiYear: number;
  kpiMonth: number;
  empresaName?: string;
  defaultOpen?: boolean;
  className?: string;
};

export function SlaTrazabilidadPanel({
  service,
  solicitudes,
  turnos,
  kpiYear,
  kpiMonth,
  empresaName,
  defaultOpen = false,
  className = '',
}: SlaTrazabilidadPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  const monthMeta = useMemo(
    () => monthRangeForService(kpiYear, kpiMonth, service),
    [kpiYear, kpiMonth, service],
  );

  const rows = useMemo(() => {
    const all = buildServiceModificaciones(service, solicitudes, turnos);
    return filterModificacionesForMonth(all, kpiYear, kpiMonth, service);
  }, [service, solicitudes, turnos, kpiYear, kpiMonth]);

  const showCancelBanner = Boolean(service.cancelReason)
    && monthMeta
    && service.cancelledAt
    && String(service.cancelledAt).slice(0, 10) >= monthMeta.start
    && String(service.cancelledAt).slice(0, 10) <= monthMeta.end;

  if (rows.length === 0 && !showCancelBanner) return null;

  const monthLabel = monthMeta?.label
    || new Date(kpiYear, kpiMonth, 1).toLocaleString('es-AR', { month: 'long', year: 'numeric' });

  const handlePdf = () => {
    exportSlaTrazabilidadPdf({
      service,
      rows,
      monthLabel,
      empresaName,
      cancelReason: showCancelBanner ? service.cancelReason : undefined,
      cancelledBy: showCancelBanner ? service.cancelledBy : undefined,
      cancelledAt: showCancelBanner ? service.cancelledAt : undefined,
    });
  };

  return (
    <div className={`bg-slate-50 dark:bg-slate-900/30 rounded-xl border dark:border-slate-700/50 ${className}`}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200/80 dark:border-slate-700/80">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left hover:text-indigo-600 transition-colors"
        >
          <FileText size={16} className="text-indigo-500 shrink-0"/>
          <span className="text-sm font-black uppercase text-slate-700 dark:text-white truncate">
            Trazabilidad
          </span>
          <span className="text-[10px] font-bold text-slate-400 capitalize truncate hidden sm:inline">
            · {monthLabel}
          </span>
          <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-full shrink-0">
            {rows.length}
          </span>
          <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}/>
        </button>
        <button
          type="button"
          onClick={handlePdf}
          disabled={rows.length === 0}
          title="Descargar PDF del mes"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border transition-colors shrink-0 disabled:opacity-40 bg-white dark:bg-slate-800 text-indigo-600 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
        >
          <Download size={12}/> PDF
        </button>
      </div>

      {open && (
        <div className="p-4 space-y-3">
          {showCancelBanner && (
            <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              Baja del servicio: {service.cancelReason}
              {service.cancelledBy ? ` · ${service.cancelledBy}` : ''}
              {service.cancelledAt ? ` · ${formatModificacionFechaAr(String(service.cancelledAt))}` : ''}
            </p>
          )}

          {rows.length === 0 ? (
            <p className="text-[11px] text-slate-400 font-medium py-2">Sin modificaciones en {monthLabel}.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <table className="w-full min-w-[640px] text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100/80 dark:bg-slate-900/50 text-[9px] font-black uppercase text-slate-500 tracking-wide">
                    <th className="px-3 py-2 whitespace-nowrap">Fecha</th>
                    <th className="px-3 py-2 whitespace-nowrap">Tipo</th>
                    <th className="px-3 py-2 whitespace-nowrap">Acción</th>
                    <th className="px-3 py-2">Detalle</th>
                    <th className="px-3 py-2 whitespace-nowrap text-right">Hs</th>
                    <th className="px-3 py-2 whitespace-nowrap">Usuario</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.key}
                      className="border-t border-slate-100 dark:border-slate-700/80 text-[11px] hover:bg-slate-50/80 dark:hover:bg-slate-900/30"
                    >
                      <td className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {formatModificacionFechaAr(row.at)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${KIND_STYLES[row.kind]}`}>
                          {row.kind}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-black text-slate-800 dark:text-slate-100 whitespace-nowrap max-w-[140px] truncate" title={row.title}>
                        {row.title}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300 max-w-[280px] truncate" title={row.detail}>
                        {row.detail}
                      </td>
                      <td className="px-3 py-2 font-black text-indigo-600 text-right whitespace-nowrap">
                        {row.hours != null && row.hours > 0 ? `${row.hours}h` : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap max-w-[120px] truncate" title={row.actor}>
                        {row.actor || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
