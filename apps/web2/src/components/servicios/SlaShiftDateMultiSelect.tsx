import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { buildCalendarMonthsForService } from '@/lib/planificacion/autoLabServicePeriod';
import { isArgentineHoliday } from '@/lib/servicios/slaHoursCalculator';
import { SLA_SHIFT_WD_HEADERS, sortYmdDates } from '@/lib/servicios/slaShiftCalendarUtils';

interface SlaShiftDateMultiSelectProps {
  serviceStartDate: string;
  serviceEndDate: string;
  selectedDates: string[];
  onChange: (dates: string[]) => void;
  disabledDates?: Set<string>;
  maxHeightClass?: string;
}

function monthKey(year: number, month: number): string {
  return `${year}-${month}`;
}

export function SlaShiftDateMultiSelect({
  serviceStartDate,
  serviceEndDate,
  selectedDates,
  onChange,
  disabledDates,
  maxHeightClass = 'max-h-[280px]',
}: SlaShiftDateMultiSelectProps) {
  const months = useMemo(
    () => buildCalendarMonthsForService(serviceStartDate, serviceEndDate),
    [serviceStartDate, serviceEndDate],
  );

  const selectedSet = useMemo(() => new Set(selectedDates), [selectedDates]);

  const initialMonthIdx = useMemo(() => {
    if (months.length === 0) return 0;
    const firstSelected = selectedDates[0];
    if (firstSelected) {
      const idx = months.findIndex((m) =>
        m.days.some((d) => d.ds === firstSelected),
      );
      if (idx >= 0) return idx;
    }
    return 0;
  }, [months, selectedDates]);

  const [monthIdx, setMonthIdx] = React.useState(initialMonthIdx);

  React.useEffect(() => {
    setMonthIdx(initialMonthIdx);
  }, [initialMonthIdx, serviceStartDate, serviceEndDate]);

  const toggleDate = (ds: string) => {
    if (disabledDates?.has(ds)) return;
    const next = selectedSet.has(ds)
      ? selectedDates.filter((d) => d !== ds)
      : sortYmdDates([...selectedDates, ds]);
    onChange(next);
  };

  const selectAllInMonth = (days: Array<{ ds: string; inRange: boolean }>) => {
    const inRange = days.filter((d) => d.inRange && d.ds && !disabledDates?.has(d.ds)).map((d) => d.ds);
    onChange(sortYmdDates([...new Set([...selectedDates, ...inRange])]));
  };

  const clearAllInMonth = (days: Array<{ ds: string; inRange: boolean }>) => {
    const inMonth = new Set(days.filter((d) => d.ds).map((d) => d.ds));
    onChange(selectedDates.filter((d) => !inMonth.has(d)));
  };

  if (!serviceStartDate || !serviceEndDate) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-950">
        Definí las fechas del contrato SLA para seleccionar días.
      </div>
    );
  }

  if (months.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-950">
        El rango del contrato no es válido.
      </div>
    );
  }

  const mo = months[Math.min(monthIdx, months.length - 1)];
  const firstDow = new Date(mo.year, mo.month, 1).getDay();
  const pad = firstDow === 0 ? 6 : firstDow - 1;

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 overflow-hidden">
      <div className="px-3 py-2 border-b border-indigo-100 flex items-center justify-between gap-2 bg-white/80">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={monthIdx <= 0}
            onClick={() => setMonthIdx((i) => Math.max(0, i - 1))}
            className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 text-slate-600"
          >
            <ChevronLeft size={14} />
          </button>
          <p className="text-[10px] font-black uppercase text-indigo-700 capitalize min-w-[120px] text-center">
            {mo.label}
          </p>
          <button
            type="button"
            disabled={monthIdx >= months.length - 1}
            onClick={() => setMonthIdx((i) => Math.min(months.length - 1, i + 1))}
            className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 text-slate-600"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => selectAllInMonth(mo.days)}
            className="text-[8px] font-black uppercase text-indigo-600 hover:text-indigo-800 px-1.5"
          >
            Todo el mes
          </button>
          <button
            type="button"
            onClick={() => clearAllInMonth(mo.days)}
            className="text-[8px] font-black uppercase text-slate-400 hover:text-rose-600 px-1.5"
          >
            Limpiar mes
          </button>
        </div>
      </div>

      <div className={`p-3 overflow-y-auto ${maxHeightClass}`}>
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {SLA_SHIFT_WD_HEADERS.map((h) => (
            <span key={h} className="text-center text-[8px] font-black text-slate-400 py-0.5">{h}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({ length: pad }).map((_, i) => (
            <span key={`pad-${monthKey(mo.year, mo.month)}-${i}`} />
          ))}
          {mo.days.map(({ date, ds, inRange }) => {
            if (!inRange || !ds) {
              return (
                <span
                  key={`out-${date.getTime()}`}
                  className="text-center text-[9px] text-slate-200 py-1.5"
                >
                  {date.getDate()}
                </span>
              );
            }
            const selected = selectedSet.has(ds);
            const blocked = disabledDates?.has(ds);
            const holiday = isArgentineHoliday(ds);
            const weekend = date.getDay() === 0 || date.getDay() === 6;
            return (
              <button
                key={ds}
                type="button"
                title={blocked ? `${ds} · no disponible` : ds}
                disabled={blocked}
                onClick={() => toggleDate(ds)}
                className={`text-center text-[9px] font-bold py-1.5 rounded transition-colors leading-none
                  ${blocked ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : ''}
                  ${!blocked && selected ? 'bg-indigo-600 text-white shadow-sm' : ''}
                  ${!blocked && !selected && holiday ? 'bg-amber-50 text-amber-800 hover:bg-indigo-100 border border-amber-200' : ''}
                  ${!blocked && !selected && !holiday && weekend ? 'text-amber-600 hover:bg-indigo-100' : ''}
                  ${!blocked && !selected && !holiday && !weekend ? 'text-slate-700 hover:bg-indigo-100' : ''}
                `}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>

        <p className="text-[9px] text-slate-500 mt-2">
          Click en cada día para seleccionar o deseleccionar. Vigencia: {serviceStartDate} → {serviceEndDate}.
        </p>
      </div>

      {selectedDates.length > 0 && (
        <div className="px-3 py-2 border-t border-indigo-100 bg-white/90">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[9px] font-black uppercase text-indigo-600">
              {selectedDates.length} fecha{selectedDates.length !== 1 ? 's' : ''} seleccionada{selectedDates.length !== 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[8px] font-black uppercase text-rose-500 hover:text-rose-700"
            >
              Limpiar todo
            </button>
          </div>
          <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
            {selectedDates.map((d) => (
              <span
                key={d}
                className="flex items-center gap-0.5 bg-indigo-100 text-indigo-700 text-[8px] font-bold px-1.5 py-0.5 rounded-full"
              >
                {d}
                <button
                  type="button"
                  onClick={() => onChange(selectedDates.filter((x) => x !== d))}
                  className="hover:text-rose-500 leading-none"
                >
                  <X size={8} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
