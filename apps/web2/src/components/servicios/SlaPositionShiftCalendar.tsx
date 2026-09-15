import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Paintbrush } from 'lucide-react';
import type { ShiftVariant } from '@/services/slaService';
import { buildCalendarMonthsForService } from '@/lib/planificacion/autoLabServicePeriod';
import { isArgentineHoliday } from '@/lib/servicios/slaHoursCalculator';
import {
  SLA_SHIFT_WD_HEADERS,
  buildShiftsByDateMap,
  isSpecificDateShift,
  shiftHasDate,
  toggleShiftDate,
} from '@/lib/servicios/slaShiftCalendarUtils';

const CHIP_COLORS = [
  'bg-orange-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-cyan-600',
  'bg-amber-600',
  'bg-fuchsia-500',
  'bg-teal-600',
];

interface SlaPositionShiftCalendarProps {
  serviceStartDate: string;
  serviceEndDate: string;
  shifts: ShiftVariant[];
  onShiftsChange: (shifts: ShiftVariant[]) => void;
  paintingShiftCode: string | null;
  onPaintingShiftCodeChange: (code: string | null) => void;
}

export function SlaPositionShiftCalendar({
  serviceStartDate,
  serviceEndDate,
  shifts,
  onShiftsChange,
  paintingShiftCode,
  onPaintingShiftCodeChange,
}: SlaPositionShiftCalendarProps) {
  const months = useMemo(
    () => buildCalendarMonthsForService(serviceStartDate, serviceEndDate),
    [serviceStartDate, serviceEndDate],
  );

  const paintableShifts = useMemo(
    () => shifts.filter((s) => s.isCustom),
    [shifts],
  );

  const shiftsByDate = useMemo(() => buildShiftsByDateMap(shifts), [shifts]);

  const colorByCode = useMemo(() => {
    const map = new Map<string, string>();
    paintableShifts.forEach((s, i) => {
      map.set(s.code, CHIP_COLORS[i % CHIP_COLORS.length]);
    });
    return map;
  }, [paintableShifts]);

  const [monthIdx, setMonthIdx] = useState(0);

  React.useEffect(() => {
    setMonthIdx(0);
  }, [serviceStartDate, serviceEndDate]);

  const handleDayClick = (ds: string) => {
    if (!paintingShiftCode) return;
    const target = shifts.find((s) => s.code === paintingShiftCode);
    if (!target) return;
    onShiftsChange(toggleShiftDate(shifts, paintingShiftCode, ds));
  };

  if (!serviceStartDate || !serviceEndDate || months.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-950">
        Definí las fechas del contrato SLA para usar el calendario pintor.
      </div>
    );
  }

  const mo = months[Math.min(monthIdx, months.length - 1)];
  const firstDow = new Date(mo.year, mo.month, 1).getDay();
  const pad = firstDow === 0 ? 6 : firstDow - 1;
  const activePaint = paintingShiftCode
    ? shifts.find((s) => s.code === paintingShiftCode)
    : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 space-y-2">
        <div className="flex items-center gap-2">
          <Paintbrush size={14} className="text-indigo-600 shrink-0" />
          <div>
            <p className="text-[10px] font-black uppercase text-slate-700">Calendario del mes</p>
            <p className="text-[9px] text-slate-500">
              Elegí un turno y marcá días. Mismo día puede tener varios turnos distintos.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[8px] font-black uppercase text-slate-400">Pintar:</span>
          {paintableShifts.length === 0 ? (
            <span className="text-[9px] text-slate-400 italic">Agregá turnos a medida primero</span>
          ) : (
            paintableShifts.map((s) => {
              const active = paintingShiftCode === s.code;
              const chipColor = colorByCode.get(s.code) || 'bg-slate-600';
              const dateCount = s.specificDates?.length || 0;
              return (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => onPaintingShiftCodeChange(active ? null : s.code)}
                  className={`px-2 py-1 rounded-lg text-[9px] font-black border transition-all ${
                    active
                      ? `${chipColor} text-white border-transparent ring-2 ring-indigo-300`
                      : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'
                  }`}
                  title={`${s.name} · ${s.startTime}–${s.endTime}${dateCount ? ` · ${dateCount} fechas` : ''}`}
                >
                  {s.code}
                  {dateCount > 0 && (
                    <span className={`ml-1 ${active ? 'text-white/80' : 'text-indigo-500'}`}>
                      ({dateCount})
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {activePaint && (
          <p className="text-[9px] font-bold text-indigo-700">
            Pintando <span className="font-black">{activePaint.code}</span> — {activePaint.name} ({activePaint.startTime}–{activePaint.endTime})
          </p>
        )}
      </div>

      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between bg-white">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={monthIdx <= 0}
            onClick={() => setMonthIdx((i) => Math.max(0, i - 1))}
            className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 text-slate-600"
          >
            <ChevronLeft size={14} />
          </button>
          <p className="text-[10px] font-black uppercase text-slate-600 capitalize min-w-[120px] text-center">
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
        <span className="text-[8px] font-bold text-slate-400">
          {serviceStartDate} → {serviceEndDate}
        </span>
      </div>

      <div className="p-3">
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {SLA_SHIFT_WD_HEADERS.map((h) => (
            <span key={h} className="text-center text-[8px] font-black text-slate-400 py-0.5">{h}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({ length: pad }).map((_, i) => (
            <span key={`pad-${i}`} />
          ))}
          {mo.days.map(({ date, ds, inRange }) => {
            if (!inRange || !ds) {
              return (
                <span
                  key={`out-${date.getTime()}`}
                  className="text-center text-[9px] text-slate-200 py-2"
                >
                  {date.getDate()}
                </span>
              );
            }

            const dayShifts = shiftsByDate.get(ds) || [];
            const isPaintTarget = paintingShiftCode && shiftHasDate(
              shifts.find((s) => s.code === paintingShiftCode) || { code: '' } as ShiftVariant,
              ds,
            );
            const holiday = isArgentineHoliday(ds);
            const weekend = date.getDay() === 0 || date.getDay() === 6;
            const canPaint = !!paintingShiftCode;

            return (
              <button
                key={ds}
                type="button"
                title={dayShifts.map((s) => s.code).join(', ') || ds}
                onClick={() => handleDayClick(ds)}
                disabled={!canPaint}
                className={`min-h-[36px] rounded-lg text-[9px] font-bold transition-colors flex flex-col items-center justify-start pt-0.5 px-0.5 gap-0.5 leading-none
                  ${canPaint ? 'cursor-pointer hover:ring-2 hover:ring-indigo-300' : 'cursor-default'}
                  ${isPaintTarget ? 'bg-indigo-100 ring-1 ring-indigo-400' : ''}
                  ${!isPaintTarget && dayShifts.length > 0 ? 'bg-slate-50 border border-slate-200' : ''}
                  ${!isPaintTarget && dayShifts.length === 0 && holiday ? 'bg-amber-50 text-amber-800' : ''}
                  ${!isPaintTarget && dayShifts.length === 0 && !holiday && weekend ? 'text-amber-600' : ''}
                  ${!isPaintTarget && dayShifts.length === 0 && !holiday && !weekend ? 'text-slate-700 hover:bg-slate-50' : ''}
                `}
              >
                <span>{date.getDate()}</span>
                <div className="flex flex-wrap gap-0.5 justify-center w-full">
                  {dayShifts.slice(0, 3).map((s) => (
                    <span
                      key={`${ds}-${s.code}`}
                      className={`text-[6px] font-black text-white px-0.5 rounded ${colorByCode.get(s.code) || 'bg-slate-500'}`}
                    >
                      {s.code}
                    </span>
                  ))}
                  {dayShifts.length > 3 && (
                    <span className="text-[6px] font-black text-slate-500">+{dayShifts.length - 3}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {paintableShifts.some(isSpecificDateShift) && (
        <div className="px-3 py-2 border-t border-slate-100 bg-slate-50">
          <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Leyenda</p>
          <div className="flex flex-wrap gap-2">
            {paintableShifts.filter(isSpecificDateShift).map((s) => (
              <span key={s.code} className="inline-flex items-center gap-1 text-[8px] font-bold text-slate-600">
                <span className={`w-2 h-2 rounded ${colorByCode.get(s.code) || 'bg-slate-500'}`} />
                {s.code} · {s.specificDates?.length || 0} días
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
