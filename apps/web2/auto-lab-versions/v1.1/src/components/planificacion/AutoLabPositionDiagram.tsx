import React, { useMemo } from 'react';
import type { V2PositionDef, V2ShiftDef } from '@/lib/planificacion/autoScheduleEngineV2';
import { calculatePositionSlaHoursForMonth } from '@/lib/planificacion/autoLabServicePeriod';
import {
    formatPlanningShiftScheduleLabel,
    formatPositionActiveDaysLabel,
    resolvePlanningShiftHours,
    resolvePlanningShiftName,
    type PlanningPositionShiftRow,
} from '@/lib/planningPositionDays';
import { Clock } from 'lucide-react';

export interface AutoLabPositionDiagramSlaContext {
    year: number;
    month: number;
    serviceStart: string;
    serviceEnd: string;
    excludedDates?: string[];
}

export interface AutoLabPositionDiagramProps {
    positions: V2PositionDef[];
    variant?: 'default' | 'real';
    slaContext?: AutoLabPositionDiagramSlaContext;
}

function toShiftRow(shift: V2ShiftDef): PlanningPositionShiftRow {
    return {
        code: String(shift.code || '').toUpperCase(),
        hours: Number(shift.hours) || 0,
        name: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        days: shift.days,
        specificDates: shift.specificDates,
    };
}

function ShiftDetailRow({
    shift,
    borderClass,
}: {
    shift: V2ShiftDef;
    borderClass: string;
}) {
    const row = toShiftRow(shift);
    const code = String(shift.code || '').toUpperCase();
    const hours = resolvePlanningShiftHours(row);
    const schedule = formatPlanningShiftScheduleLabel(row);
    const label = resolvePlanningShiftName(row);
    const shiftDays = shift.days?.length ? formatPositionActiveDaysLabel(shift.days) : null;

    return (
        <div
            className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-white border px-2.5 py-1.5 text-[11px] ${borderClass}`}
        >
            <span className="font-mono font-black text-indigo-800">{code}</span>
            {label !== code && (
                <span className="text-slate-600 font-semibold">{label}</span>
            )}
            <span className="inline-flex items-center gap-1 text-slate-600 font-medium">
                <Clock size={10} className="text-slate-400" />
                {schedule}
            </span>
            <span className="font-black text-emerald-700">{hours} h</span>
            {shiftDays && (
                <span className="text-[10px] font-bold uppercase text-slate-400">{shiftDays}</span>
            )}
        </div>
    );
}

export default function AutoLabPositionDiagram({
    positions,
    variant = 'default',
    slaContext,
}: AutoLabPositionDiagramProps) {
    const isReal = variant === 'real';
    const cardBorder = isReal ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50';
    const chipBorder = isReal ? 'border-emerald-200' : 'border-slate-200';
    const shiftBorder = isReal ? 'border-emerald-200' : 'border-slate-200';

    const monthlyHoursByPosition = useMemo(() => {
        if (!slaContext?.serviceStart || !slaContext?.serviceEnd) return new Map<string, number>();
        const map = new Map<string, number>();
        for (const pos of positions) {
            const h = calculatePositionSlaHoursForMonth(
                pos,
                slaContext.serviceStart,
                slaContext.serviceEnd,
                slaContext.excludedDates,
                slaContext.year,
                slaContext.month,
            );
            map.set(pos.positionName, h);
        }
        return map;
    }, [positions, slaContext]);

    return (
        <div className="space-y-3">
            {positions.map((pos) => {
                const shifts = pos.shifts || [];
                const days = formatPositionActiveDaysLabel(pos.activeDays);
                const monthlySla = monthlyHoursByPosition.get(pos.positionName);

                return (
                    <div
                        key={pos.positionName}
                        className={`rounded-2xl border p-4 shadow-sm ${cardBorder}`}
                    >
                        <div className="flex items-start justify-between gap-2">
                            <p className="font-black text-slate-800 text-sm">{pos.positionName}</p>
                            <span
                                className={`text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full ${
                                    isReal
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-indigo-100 text-indigo-800'
                                }`}
                            >
                                ×{Math.max(1, Number(pos.qty) || 1)}
                            </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <span className={`rounded-lg bg-white border px-2 py-1 text-slate-600 ${chipBorder}`}>
                                {String(pos.coverageType || 'custom')}
                            </span>
                            <span className={`rounded-lg bg-white border px-2 py-1 text-slate-600 ${chipBorder}`}>
                                {days}
                            </span>
                            {monthlySla != null && monthlySla > 0 && (
                                <span className={`rounded-lg bg-white border px-2 py-1 font-bold text-indigo-800 ${chipBorder}`}>
                                    SLA mes: {monthlySla} h
                                </span>
                            )}
                        </div>
                        {shifts.length > 0 && (
                            <div className="mt-3 space-y-1.5">
                                <p className="text-[9px] font-black uppercase tracking-wide text-slate-400">
                                    Turnos y horarios
                                </p>
                                {shifts.map((shift) => (
                                    <ShiftDetailRow
                                        key={`${pos.positionName}-${shift.code}`}
                                        shift={shift}
                                        borderClass={shiftBorder}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
