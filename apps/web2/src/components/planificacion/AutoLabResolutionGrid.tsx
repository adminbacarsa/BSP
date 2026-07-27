import React, { useMemo, useState } from 'react';
import type { V2EmployeeDef } from '@/lib/planificacion/autoScheduleEngineV2';
import { isCustomCoverPosition } from '@/lib/planificacion/autoScheduleEngineV2';
import type { AutoLabRunResult } from '@/lib/planificacion/autoLabRuntime';
import {
    buildAssignmentIndex,
    buildEmployeePositionMap,
    is24hsPosition,
    positionBadgeClass,
    shiftCodeCellClass,
    shortPositionLabel,
    type AutoLabScheduleOutcome,
} from '@/lib/planificacion/autoLabSchedule';
import { buildPositionRequiredHeadcountMap } from '@/lib/planificacion/objectiveHeadcount';
import { getAutoLabDateKey } from '@/lib/planificacion/autoLabRuntime';
import { isExternalRetEmpId, shortExternalRetLabel } from '@/lib/planificacion/externalRetCoverage';
import { isHolidayDate } from '@/lib/planificacion/autoLabServicePeriod';
import { AlertTriangle, CalendarRange, CheckCircle2, Grid3x3, Users } from 'lucide-react';

const WD_SHORT_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const;
const WORK_BANDS = new Set(['M', 'T', 'N', 'D12', 'N12']);
const ABSENCE_CODES = new Set(['V', 'L', 'E', 'A', 'AA', 'PG']);

function isWorkBandCode(code: string): boolean {
    return WORK_BANDS.has(String(code || '').toUpperCase());
}

type DayAssignmentCell = {
    code?: string;
    name?: string;
    positionName?: string;
    hours?: number;
};

function resolveDayCellDisplay(
    cells: DayAssignmentCell[],
    homePos: string,
    sparsePool = false,
): { primary?: DayAssignmentCell; displayCode: string; title: string } {
    if (cells.length === 0) {
        return {
            displayCode: '—',
            title: sparsePool ? 'Sin uso en este objetivo (puede tener turno en otro)' : 'Sin asignación',
        };
    }

    const absence = cells.find((c) => ABSENCE_CODES.has(String(c.code || '').toUpperCase()));
    if (absence) {
        return {
            primary: absence,
            displayCode: String(absence.code).toUpperCase(),
            title: `Ausencia ${absence.code}`,
        };
    }

    const billable = cells.find(
        (c) => isWorkBandCode(String(c.code)) && (Number(c.hours) || 0) > 0,
    );
    if (billable) {
        const atOther = billable.positionName && homePos && billable.positionName !== homePos;
        return {
            primary: billable,
            displayCode: String(billable.code).toUpperCase(),
            title: atOther
                ? `Cubre ${billable.positionName} · ${billable.code}`
                : `${billable.name || billable.code} · ${billable.positionName || homePos}`,
        };
    }

    if (sparsePool) {
        const franco = cells.find((c) => String(c.code || '').toUpperCase() === 'F');
        if (franco) {
            return {
                primary: franco,
                displayCode: 'F',
                title: 'Franco por racha CCT en este objetivo',
            };
        }
        return {
            displayCode: '—',
            title: 'Sin uso en este objetivo (puede tener turno en otro)',
        };
    }

    const primary = cells[0];
    return {
        primary,
        displayCode: primary?.code || '—',
        title: primary
            ? `${primary.name || primary.code} · ${primary.positionName ?? homePos}`
            : 'Sin asignación',
    };
}

function formatGridDay(day: Date): { dd: string; wd: string } {
    return {
        dd: String(day.getDate()).padStart(2, '0'),
        wd: WD_SHORT_ES[day.getDay()] ?? '',
    };
}

interface AutoLabResolutionGridProps {
    runResult: AutoLabRunResult;
    scheduleOutcome: AutoLabScheduleOutcome;
}

function shortEmpLabel(emp: V2EmployeeDef): string {
    return shortExternalRetLabel(emp);
}

function positionCoverageKind(
    positionName: string,
    positions: AutoLabRunResult['positions'],
): '24hs' | 'custom' | null {
    const meta = positions.find((p) => p.positionName === positionName);
    if (!meta) return null;
    if (is24hsPosition(meta)) return '24hs';
    if (isCustomCoverPosition(meta)) return 'custom';
    return null;
}

function positionCoverageBadge(kind: '24hs' | 'custom' | null): string {
    if (kind === '24hs') return 'bg-indigo-100 text-indigo-900 border-indigo-300';
    if (kind === 'custom') return 'bg-amber-100 text-amber-950 border-amber-300';
    return '';
}

export default function AutoLabResolutionGrid({
    runResult,
    scheduleOutcome,
}: AutoLabResolutionGridProps) {
    const [viewMode, setViewMode] = useState<'week' | 'month'>('week');

    const activeDayKeys = useMemo(
        () => new Set(runResult.daysInMonth.map((d) => getAutoLabDateKey(d))),
        [runResult.daysInMonth],
    );

    const excludedServiceDayKeys = useMemo(
        () => new Set(runResult.serviceExcludedDates || []),
        [runResult.serviceExcludedDates],
    );

    const displayDays = useMemo(() => {
        const all = runResult.fullMonthDays;
        if (viewMode === 'month') return all;
        const firstActiveIdx = all.findIndex((d) => activeDayKeys.has(getAutoLabDateKey(d)));
        const start = firstActiveIdx >= 0 ? firstActiveIdx : 0;
        return all.slice(start, start + 7);
    }, [runResult.fullMonthDays, viewMode, activeDayKeys]);

    const assignmentIndex = useMemo(() => {
        if (!scheduleOutcome.generation) return null;
        return buildAssignmentIndex(scheduleOutcome.generation.assignments);
    }, [scheduleOutcome.generation]);

    const stats = scheduleOutcome.generation?.stats;
    const uncoveredByDay = stats?.uncoveredSlotsByDay ?? {};

    const allEmployees = useMemo(() => {
        const internal = [...runResult.employees];
        const external = scheduleOutcome.externalRetEmployees ?? [];
        return [...internal, ...external];
    }, [runResult.employees, scheduleOutcome.externalRetEmployees]);

    const empPositionMap = useMemo(() => {
        if (!scheduleOutcome.generation) return {};
        return buildEmployeePositionMap(
            allEmployees,
            scheduleOutcome.generation.assignments,
            stats?.positionGroups,
            stats?.idleEmployeeIds,
        );
    }, [scheduleOutcome.generation, allEmployees, stats?.positionGroups, stats?.idleEmployeeIds]);

    const primaryShiftByEmp = stats?.primaryShiftByEmp ?? {};

    const cycleNeededByPos = useMemo(() => {
        const cycleKey = runResult.brain?.pickedCycle ?? '6+2';
        return buildPositionRequiredHeadcountMap(runResult.positions, cycleKey);
    }, [runResult.brain, runResult.positions]);

    const idleEmployeeIdSet = useMemo(
        () => new Set(stats?.idleEmployeeIds ?? []),
        [stats?.idleEmployeeIds],
    );

    const positionSummary = useMemo(() => {
        return runResult.positions.map((pos) => {
            const ids = stats?.positionGroups?.[pos.positionName] ?? [];
            const titularIds = ids.filter((id) => !idleEmployeeIdSet.has(id));
            const bands = [...new Set(
                titularIds.map((id) => primaryShiftByEmp[id]).filter(Boolean) as string[],
            )];
            const cycleNeeded = cycleNeededByPos[pos.positionName];
            return {
                ...pos,
                guardIds: ids,
                titularGuardIds: titularIds,
                bandHint: bands.length > 0 ? bands.join('/') : '—',
                cycleNeeded,
                overStaffed: cycleNeeded != null && titularIds.length > cycleNeeded,
            };
        });
    }, [runResult.positions, stats?.positionGroups, primaryShiftByEmp, cycleNeededByPos, idleEmployeeIdSet]);

    type GridRow =
        | { type: 'header'; positionName: string; qty: number; guardCount: number; bandHint: string; cycleNeeded?: number; overStaffed?: boolean; external?: boolean; surplus?: boolean }
        | { type: 'emp'; emp: V2EmployeeDef; homePosition: string; isSurplus?: boolean };

    const groupedRows = useMemo((): GridRow[] => {
        const rows: GridRow[] = [];
        const inRoster = new Set<string>();

        for (const summary of positionSummary) {
            const emps = summary.titularGuardIds
                .map((id) => allEmployees.find((e) => e.id === id))
                .filter((e): e is V2EmployeeDef => !!e && !isExternalRetEmpId(e.id));
            if (emps.length === 0) continue;
            emps.forEach((e) => inRoster.add(e.id));
            rows.push({
                type: 'header',
                positionName: summary.positionName,
                qty: summary.qty,
                guardCount: emps.length,
                bandHint: summary.bandHint,
                cycleNeeded: summary.cycleNeeded,
                overStaffed: summary.overStaffed,
            });
            for (const emp of emps) {
                rows.push({ type: 'emp', emp, homePosition: summary.positionName });
            }
        }

        const surplusEmps = (stats?.idleEmployeeIds ?? [])
            .map((id) => allEmployees.find((e) => e.id === id))
            .filter((e): e is V2EmployeeDef => !!e && !isExternalRetEmpId(e.id));
        if (surplusEmps.length > 0) {
            surplusEmps.forEach((e) => inRoster.add(e.id));
            rows.push({
                type: 'header',
                positionName: 'Excedente (cobertura / RET)',
                qty: 0,
                guardCount: surplusEmps.length,
                bandHint: 'M/T/N puntual · sin RET de relleno',
                overStaffed: false,
                surplus: true,
            });
            for (const emp of surplusEmps) {
                rows.push({
                    type: 'emp',
                    emp,
                    homePosition: empPositionMap[emp.id] ?? '',
                    isSurplus: true,
                });
            }
        }

        const unassigned = allEmployees.filter(
            (e) => !isExternalRetEmpId(e.id) && !inRoster.has(e.id),
        );
        if (unassigned.length > 0) {
            rows.push({
                type: 'header',
                positionName: 'Sin puesto asignado',
                qty: 0,
                guardCount: unassigned.length,
                bandHint: '—',
            });
            for (const emp of unassigned) {
                rows.push({ type: 'emp', emp, homePosition: empPositionMap[emp.id] ?? '' });
            }
        }

        const external = allEmployees.filter((e) => isExternalRetEmpId(e.id));
        if (external.length > 0) {
            rows.push({
                type: 'header',
                positionName: 'RET externo (otro objetivo)',
                qty: 0,
                guardCount: external.length,
                bandHint: 'stand-by',
                external: true,
            });
            for (const emp of external) {
                rows.push({ type: 'emp', emp, homePosition: '' });
            }
        }

        return rows;
    }, [positionSummary, allEmployees, stats?.idleEmployeeIds, empPositionMap]);

    if (scheduleOutcome.error && !scheduleOutcome.generation) {
        return (
            <div className="rounded-2xl bg-white border border-amber-200 shadow-sm p-6">
                <p className="text-xs font-black uppercase text-amber-800 flex items-center gap-2">
                    <AlertTriangle size={14} />
                    Resolución cronograma
                </p>
                <p className="text-sm text-amber-950 mt-2">{scheduleOutcome.error}</p>
            </div>
        );
    }

    if (!scheduleOutcome.generation || !assignmentIndex) {
        return (
            <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6 text-sm text-slate-500">
                Sin cronograma generado.
            </div>
        );
    }

    const colSpan = displayDays.length + 2;

    return (
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-indigo-50 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Grid3x3 size={18} className="text-emerald-700" />
                    <div>
                        <h2 className="font-black text-slate-800 text-sm uppercase tracking-wide">
                            Resolución del cronograma
                        </h2>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                            Motor {scheduleOutcome.pipeline === 'fixedBandFloater' ? '6+2 flotante' : 'V4'}
                            {' · '}
                            {scheduleOutcome.generation.assignments.length} asignaciones
                            {' · '}
                            1 fila por guardia
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setViewMode('week')}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-colors ${
                            viewMode === 'week'
                                ? 'bg-indigo-600 text-white border-indigo-500'
                                : 'bg-white text-slate-600 border-slate-200'
                        }`}
                    >
                        7 días
                    </button>
                    <button
                        type="button"
                        onClick={() => setViewMode('month')}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-colors ${
                            viewMode === 'month'
                                ? 'bg-indigo-600 text-white border-indigo-500'
                                : 'bg-white text-slate-600 border-slate-200'
                        }`}
                    >
                        Mes completo
                    </button>
                </div>
            </div>

            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex flex-wrap gap-3 text-xs">
                <span className="inline-flex items-center gap-1 font-bold text-slate-700">
                    <CheckCircle2 size={12} className="text-emerald-600" />
                    {Math.round(stats?.totalBillableHours ?? 0)} h facturables
                </span>
                <span className="text-slate-500">·</span>
                <span className="font-bold text-slate-700">SLA {runResult.slaVendidas} h</span>
                <span className="text-slate-500">·</span>
                <span className={`font-bold ${(stats?.uncoveredSlots ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {(stats?.uncoveredSlots ?? 0) > 0
                        ? `${stats?.uncoveredSlots} slot(s) sin cubrir`
                        : 'Cobertura completa'}
                </span>
                {stats?.slaHoursClosed && (
                    <>
                        <span className="text-slate-500">·</span>
                        <span className="font-bold text-emerald-700">SLA cerrado</span>
                    </>
                )}
            </div>

            <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-2">
                {positionSummary.map((pos) => (
                    <div
                        key={pos.positionName}
                        className={`rounded-xl border px-3 py-2 text-[10px] shadow-sm ${positionBadgeClass(pos.positionName, runResult.positions)}`}
                    >
                        <p className="font-black">{pos.positionName}</p>
                        <p className="mt-0.5 font-semibold opacity-90">
                            <Users size={10} className="inline mr-1 -mt-px" />
                            {pos.titularGuardIds.length} titulares
                            {pos.guardIds.length > pos.titularGuardIds.length && (
                                <> · +{pos.guardIds.length - pos.titularGuardIds.length} exced.</>
                            )}
                            {(() => {
                                const kind = positionCoverageKind(pos.positionName, runResult.positions);
                                if (!kind) return null;
                                return (
                                    <span className={`ml-1 rounded border px-1 py-px text-[8px] font-black uppercase ${positionCoverageBadge(kind)}`}>
                                        {kind === '24hs' ? 'M/T/N' : 'custom'}
                                    </span>
                                );
                            })()}
                            {pos.cycleNeeded != null && (
                                <> · nec. ciclo <strong>{pos.cycleNeeded}</strong></>
                            )}
                            {' · '}pax {pos.qty}
                            {pos.bandHint !== '—' && <> · banda {pos.bandHint}</>}
                            {pos.overStaffed && (
                                <span className="ml-1 text-amber-800 font-black">· SOBREDOTADO</span>
                            )}
                        </p>
                    </div>
                ))}
            </div>

            <div className="p-4 overflow-x-auto">
                <table className="min-w-full border-collapse text-[10px]">
                    <thead>
                        <tr>
                            <th className="sticky left-0 z-20 bg-white border border-slate-200 px-2 py-2 text-left font-black text-slate-600 min-w-[52px]">
                                Puesto
                            </th>
                            <th className="sticky left-[52px] z-20 bg-white border border-slate-200 px-2 py-2 text-left font-black text-slate-600 min-w-[52px]">
                                Guardia
                            </th>
                            {displayDays.map((day) => {
                                const ds = getAutoLabDateKey(day);
                                const active = activeDayKeys.has(ds);
                                const excludedService = excludedServiceDayKeys.has(ds);
                                const outOfVigencia = !active && !excludedService;
                                const holiday = active && isHolidayDate(ds);
                                const { dd, wd } = formatGridDay(day);
                                return (
                                    <th
                                        key={ds}
                                        className={`border border-slate-200 px-1 py-2 text-center font-black min-w-[36px] ${
                                            outOfVigencia
                                                ? 'bg-slate-100 text-slate-400'
                                                : excludedService
                                                  ? 'bg-violet-50 text-violet-900'
                                                : holiday
                                                  ? 'bg-amber-50 text-amber-900'
                                                  : 'bg-indigo-50 text-indigo-900'
                                        }`}
                                    >
                                        <div>{dd}</div>
                                        <div className="text-[8px] font-bold opacity-70">{wd}</div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {groupedRows.map((row) => {
                            if (row.type === 'header') {
                                const covKind = positionCoverageKind(row.positionName, runResult.positions);
                                const headerBg = row.external
                                    ? 'bg-violet-50/90'
                                    : row.surplus
                                    ? 'bg-amber-50/90'
                                    : 'bg-slate-50/90';
                                return (
                                    <tr key={`hdr-${row.positionName}`} className={headerBg}>
                                        <td
                                            colSpan={colSpan}
                                            className={`border px-3 py-1.5 text-[10px] font-black ${
                                                row.external
                                                    ? 'border-violet-200 text-violet-900'
                                                    : row.surplus
                                                    ? 'border-amber-200 text-amber-950'
                                                    : 'border-slate-200 text-slate-700'
                                            }`}
                                        >
                                            <span className={`inline-flex items-center gap-2 rounded-lg border px-2 py-0.5 ${
                                                row.surplus
                                                    ? 'bg-amber-100 text-amber-950 border-amber-300'
                                                    : row.overStaffed
                                                    ? 'bg-amber-100 text-amber-950 border-amber-400'
                                                    : row.external
                                                    ? 'bg-violet-100 text-violet-900 border-violet-300'
                                                    : positionBadgeClass(row.positionName, runResult.positions)
                                            }`}>
                                                {row.positionName}
                                                {covKind && (
                                                    <span className={`rounded border px-1 py-px text-[8px] font-black uppercase ${positionCoverageBadge(covKind)}`}>
                                                        {covKind === '24hs' ? 'rotación M/T/N' : 'custom L–V'}
                                                    </span>
                                                )}
                                                <span className="font-semibold opacity-80">
                                                    · {row.guardCount} guardia{row.guardCount !== 1 ? 's' : ''}
                                                    {row.cycleNeeded != null && (
                                                        <> · nec. {row.cycleNeeded}</>
                                                    )}
                                                    {row.qty > 0 && <> · pax {row.qty}</>}
                                                    {row.bandHint !== '—' && ` · ${row.bandHint}`}
                                                    {row.overStaffed && ' · SOBREDOTADO'}
                                                </span>
                                            </span>
                                        </td>
                                    </tr>
                                );
                            }

                            const emp = row.emp;
                            const isSurplus = row.isSurplus === true;
                            const isExt = isExternalRetEmpId(emp.id);
                            const homePos = row.homePosition || empPositionMap[emp.id] || '—';
                            const posShort = homePos !== '—'
                                ? shortPositionLabel(homePos, runResult.positions)
                                : '—';
                            const band = primaryShiftByEmp[emp.id];

                            return (
                                <tr key={emp.id} className={isExt ? 'bg-violet-50/30' : isSurplus ? 'bg-amber-50/25' : undefined}>
                                    <td className={`sticky left-0 z-10 border border-slate-200 px-2 py-1.5 text-center ${
                                        isExt ? 'bg-violet-50' : isSurplus ? 'bg-amber-50/50' : 'bg-white'
                                    }`}>
                                        <span
                                            title={isSurplus ? `Ancla: ${homePos}` : homePos}
                                            className={`inline-block rounded-md border px-1.5 py-0.5 text-[9px] font-black ${
                                                isExt
                                                    ? 'bg-violet-100 text-violet-900 border-violet-300'
                                                    : isSurplus
                                                    ? 'bg-amber-100 text-amber-950 border-amber-300'
                                                    : positionBadgeClass(homePos, runResult.positions)
                                            }`}
                                        >
                                            {isExt ? 'EXT' : isSurplus ? 'EXC' : posShort}
                                        </span>
                                    </td>
                                    <td className={`sticky left-[52px] z-10 border border-slate-200 px-2 py-1.5 font-bold whitespace-nowrap ${
                                        isExt ? 'bg-violet-50 text-violet-900' : isSurplus ? 'bg-amber-50/50 text-amber-950' : 'bg-white text-slate-800'
                                    }`}>
                                        <span title={`${emp.nombre || emp.id}${band ? ` · banda ${band}` : ''}${isSurplus ? ` · excedente (${homePos})` : ''}`}>
                                            {shortEmpLabel(emp)}
                                        </span>
                                    </td>
                                    {displayDays.map((day) => {
                                        const ds = getAutoLabDateKey(day);
                                        const active = activeDayKeys.has(ds);
                                        const excludedService = excludedServiceDayKeys.has(ds);
                                        const outOfVigencia = !active && !excludedService;
                                        if (outOfVigencia) {
                                            return (
                                                <td
                                                    key={`${emp.id}-${ds}`}
                                                    className="border border-slate-200 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(148,163,184,0.12)_3px,rgba(148,163,184,0.12)_6px)]"
                                                />
                                            );
                                        }
                                        const cells = assignmentIndex.get(emp.id)?.get(ds) ?? [];
                                        const sparsePool = isSurplus || isExt;
                                        const { primary, displayCode, title } = resolveDayCellDisplay(
                                            cells,
                                            homePos,
                                            sparsePool,
                                        );

                                        return (
                                            <td key={`${emp.id}-${ds}`} className={`border border-slate-200 p-0.5 ${excludedService ? 'bg-violet-50/40' : ''}`}>
                                                <div
                                                    title={title}
                                                    className={`h-7 rounded-md border flex items-center justify-center font-black text-[9px] leading-none ${
                                                        primary
                                                            ? shiftCodeCellClass(displayCode)
                                                            : 'bg-white text-slate-300 border-dashed border-slate-200'
                                                    }`}
                                                >
                                                    <span>{displayCode}</span>
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                        <tr className="bg-rose-50/50">
                            <td
                                colSpan={2}
                                className="sticky left-0 z-10 bg-rose-50 border border-rose-200 px-2 py-1.5 font-black text-rose-800 text-[9px]"
                                title="Déficit de slots SLA vs asignaciones (0 = cobertura completa)"
                            >
                                Huecos SLA
                            </td>
                            {displayDays.map((day) => {
                                const ds = getAutoLabDateKey(day);
                                const active = activeDayKeys.has(ds);
                                const excludedService = excludedServiceDayKeys.has(ds);
                                const outOfVigencia = !active && !excludedService;
                                const gaps = uncoveredByDay[ds] ?? [];
                                const missing = gaps.reduce((acc, g) => acc + (g.missing || 0), 0);
                                if (outOfVigencia || excludedService) {
                                    return (
                                        <td
                                            key={`gap-${ds}`}
                                            className={`border border-slate-200 px-0.5 py-1 text-center text-[9px] ${
                                                excludedService ? 'bg-violet-50 text-violet-600' : 'bg-slate-50'
                                            }`}
                                            title={excludedService ? 'Sin servicio (exclusión SLA)' : undefined}
                                        >
                                            {excludedService ? '—' : ''}
                                        </td>
                                    );
                                }
                                const detail = gaps.length > 0
                                    ? gaps.map((g) => `${g.positionName} ${g.code}×${g.missing}`).join(', ')
                                    : 'Cobertura SLA completa (0 huecos)';
                                return (
                                    <td
                                        key={`gap-${ds}`}
                                        className={`border px-0.5 py-1 text-center font-bold text-[9px] ${
                                            missing > 0
                                                ? 'border-rose-200 text-rose-700'
                                                : 'border-emerald-200 text-emerald-700'
                                        }`}
                                        title={detail}
                                    >
                                        {missing > 0 ? missing : '0'}
                                    </td>
                                );
                            })}
                        </tr>
                    </tbody>
                </table>
            </div>

            <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap gap-2 text-[9px] font-bold uppercase text-slate-500">
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-sky-500" /> M</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500" /> T</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-700" /> N</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-200" /> F</span>
                <span className="inline-flex items-center gap-1" title="Franco en día sin servicio del puesto (ej. sáb/dom en L–V)"><span className="w-3 h-3 rounded bg-slate-200 border border-slate-400" /> FF</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-violet-100 border border-violet-300" /> RET</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-300 text-[7px] px-0.5">EXC</span> Excedente (solo días de cobertura)</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded border border-dashed border-slate-300 text-[7px] px-0.5">—</span> Sin turno en este objetivo</span>
                <span className="inline-flex items-center gap-1"><CalendarRange size={10} /> Gris = fuera de vigencia</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-violet-100 border border-violet-300" /> Sin servicio (RET)</span>
            </div>
        </div>
    );
}
