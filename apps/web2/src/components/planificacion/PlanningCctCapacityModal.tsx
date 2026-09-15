import React from 'react';
import { createPortal } from 'react-dom';
import type { AutoV2GenStats } from '@/lib/planificacion/applyPlanificacionAutoScheduleV2';

type Props = {
    stats: AutoV2GenStats;
    displayedEmployees: any[];
    currentDate: Date;
    monthlyLimit: number;
    onClose: () => void;
};

const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatCycleDate(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    return `${day}-${MONTH_NAMES[date.getMonth()]}-${date.getFullYear()}`;
}

export default function PlanningCctCapacityModal({
    stats,
    displayedEmployees,
    currentDate,
    monthlyLimit,
    onClose,
}: Props) {
    if (typeof document === 'undefined') return null;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const startCurrent = new Date(year, month - 1, 26);
    const endCurrent = new Date(year, month, 25);
    const startNext = new Date(year, month, 26);
    const endNext = new Date(year, month + 1, 25);
    const monthName = currentDate.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    const idleSet = new Set(stats.idleEmployeeIds || []);
    const positionByEmployee: Record<string, string> = {};

    Object.entries(stats.positionGroups || {}).forEach(([position, employeeIds]) => {
        employeeIds.forEach((employeeId) => {
            positionByEmployee[employeeId] = position;
        });
    });

    const rows = displayedEmployees.map((employee: any) => {
        const monthHours = stats.employeeMonthlyHours[employee.id] || 0;
        const currentHours = stats.employeeCycleHours.current[employee.id] || 0;
        const nextHours = stats.employeeCycleHours.next[employee.id] || 0;
        const currentBuffer = Math.max(0, 200 - currentHours);
        const nextBuffer = Math.max(0, 200 - nextHours);
        const retCount = (stats.employeeRetCount || {})[employee.id] || 0;
        const retHours = (stats.employeeRetHoursPotential || {})[employee.id] || 0;
        const position = positionByEmployee[employee.id] || (idleSet.has(employee.id) ? '—' : 'Sin puesto');
        const isIdle = idleSet.has(employee.id);
        const isCapped = currentHours >= monthlyLimit || nextHours >= monthlyLimit;
        const isHigh = currentHours >= 192 || nextHours >= 192;
        const status = isIdle
            ? 'Capacidad ociosa'
            : isCapped
                ? `CAP ${monthlyLimit}h alcanzado`
                : isHigh
                    ? 'Cerca del cap (≥192h)'
                    : currentBuffer + nextBuffer >= 40
                        ? 'Disponible para más'
                        : 'Carga normal';
        const statusColor = isIdle
            ? 'text-slate-400'
            : isCapped
                ? 'text-rose-600'
                : isHigh
                    ? 'text-amber-600'
                    : currentBuffer + nextBuffer >= 40
                        ? 'text-emerald-600'
                        : 'text-slate-600';

        return {
            employee,
            monthHours,
            currentHours,
            nextHours,
            currentBuffer,
            nextBuffer,
            retCount,
            retHours,
            position,
            status,
            statusColor,
        };
    });

    rows.sort((a, b) => {
        const aCap = a.currentHours >= monthlyLimit || a.nextHours >= monthlyLimit ? 0 : 1;
        const bCap = b.currentHours >= monthlyLimit || b.nextHours >= monthlyLimit ? 0 : 1;
        if (aCap !== bCap) return aCap - bCap;
        return (b.currentBuffer + b.nextBuffer) - (a.currentBuffer + a.nextBuffer);
    });

    return createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white p-6 rounded-xl shadow-2xl w-[860px] max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
                <h3 className="font-black text-lg mb-1 flex items-center gap-2">
                    <span className="text-indigo-600">Cap. CCT</span>
                    <span className="text-slate-700">Capacidad por empleado — ciclo CCT</span>
                </h3>
                <p className="text-xs text-slate-600 font-medium mb-1">
                    Cronograma visualizado: <b className="text-indigo-700">{monthName}</b> (días 1..{lastDay}).
                </p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2 text-[11px]">
                        <div className="font-black text-indigo-800">Ciclo CCT actual (Current)</div>
                        <div className="text-slate-700"><b>{formatCycleDate(startCurrent)}</b> → <b>{formatCycleDate(endCurrent)}</b></div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Cola del mes anterior (días 26..fin) + días 1..25 de este mes.</div>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[11px]">
                        <div className="font-black text-amber-800">Ciclo CCT siguiente (Next)</div>
                        <div className="text-slate-700"><b>{formatCycleDate(startNext)}</b> → <b>{formatCycleDate(endNext)}</b></div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Días 26..fin de este mes pertenecen al próximo ciclo.</div>
                    </div>
                </div>
                <p className="text-xs text-slate-500 font-medium mb-4">
                    Tope CCT 422/05: <b>{monthlyLimit}h por ciclo</b>. La tabla refleja la <b>última automatización</b> de este objetivo: si corregiste datos o filtros, volvé a <b>generar</b> para actualizarla.
                    La cola del ciclo (26..mes anterior) solo suma turnos <b>de este objetivo</b> y <b>no operativos</b> (reten / cobertura ops. / SLA virtual), para no mezclar con otros cronogramas. Los borradores sí se cuentan (siguen siendo crono planificado).
                </p>

                <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-[11px] bg-white">
                        <thead className="bg-slate-50 text-slate-700">
                            <tr>
                                <th className="text-left px-3 py-2 font-black uppercase tracking-wide">Empleado</th>
                                <th className="text-left px-3 py-2 font-black uppercase tracking-wide">Puesto</th>
                                <th className="text-right px-3 py-2 font-black uppercase tracking-wide">Hs. Mes</th>
                                <th className="text-right px-3 py-2 font-black uppercase tracking-wide">CCT Current</th>
                                <th className="text-right px-3 py-2 font-black uppercase tracking-wide">CCT Next</th>
                                <th className="text-right px-3 py-2 font-black uppercase tracking-wide">Buffer Curr.</th>
                                <th className="text-right px-3 py-2 font-black uppercase tracking-wide">Buffer Next</th>
                                <th className="text-right px-3 py-2 font-black uppercase tracking-wide" title="Cantidad de RETs (retenido stand-by) que tiene asignados el empleado en el mes. Cada RET = potencial 8h de cobertura para otros objetivos.">RET</th>
                                <th className="text-right px-3 py-2 font-black uppercase tracking-wide" title="Horas RET potenciales = cantidad de RETs × 8h. NO suman a horas trabajadas, son horas de stand-by disponibles para activar como cobertura.">Hs RET</th>
                                <th className="text-left px-3 py-2 font-black uppercase tracking-wide">Estado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.employee.id} className="border-t border-slate-100 hover:bg-slate-50">
                                    <td className="px-3 py-2 font-bold text-slate-700">{row.employee.name || row.employee.nombre}</td>
                                    <td className="px-3 py-2 text-slate-500">{row.position}</td>
                                    <td className="px-3 py-2 text-right font-mono text-slate-700">{Math.round(row.monthHours)}h</td>
                                    <td className="px-3 py-2 text-right font-mono text-slate-700">{Math.round(row.currentHours)} / 200</td>
                                    <td className="px-3 py-2 text-right font-mono text-slate-700">{Math.round(row.nextHours)} / 200</td>
                                    <td className="px-3 py-2 text-right font-mono text-emerald-700">{Math.round(row.currentBuffer)}h</td>
                                    <td className="px-3 py-2 text-right font-mono text-emerald-700">{Math.round(row.nextBuffer)}h</td>
                                    <td className={`px-3 py-2 text-right font-mono ${row.retCount > 0 ? 'text-violet-700 font-bold' : 'text-slate-400'}`} title={row.retCount > 0 ? `${row.retCount} RET(s) en stand-by` : 'Sin RETs'}>{row.retCount}</td>
                                    <td className={`px-3 py-2 text-right font-mono ${row.retHours > 0 ? 'text-violet-700' : 'text-slate-400'}`} title={row.retHours > 0 ? `Hasta ${row.retHours}h potenciales activables como cobertura` : ''}>{row.retHours}h</td>
                                    <td className={`px-3 py-2 font-bold ${row.statusColor}`}>{row.status}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
                    <div className="bg-slate-50 rounded-lg p-3">
                        <div className="font-black text-slate-700 mb-1">Cómo leer la tabla</div>
                        <ul className="text-slate-600 space-y-1 list-disc list-inside">
                            <li><b>CCT Current</b>: horas ya consumidas en el ciclo CCT del mes actual (incluye cola del mes anterior).</li>
                            <li><b>CCT Next</b>: horas asignadas al ciclo siguiente (días 26..fin de este mes).</li>
                            <li><b>Buffer</b>: horas libres hasta llegar a 200h en cada ciclo.</li>
                            <li><b>RET / Hs RET</b>: cantidad de días en stand-by (retenido) y horas potenciales (RET × 8h). NO suman a horas trabajadas — son capacidad disponible para cubrir ausencias en otros objetivos.</li>
                        </ul>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                        <div className="font-black text-slate-700 mb-1">Estado</div>
                        <ul className="text-slate-600 space-y-1 list-disc list-inside">
                            <li><span className="text-rose-600 font-bold">CAP 200h</span>: no se le pueden agregar más turnos en ese ciclo.</li>
                            <li><span className="text-amber-600 font-bold">≥192h</span>: cerca del cap, no apto para horas extras en otros objetivos.</li>
                            <li><span className="text-emerald-600 font-bold">Disponible</span>: tiene buffer ≥40h para otros objetivos o emergencias.</li>
                        </ul>
                    </div>
                </div>
                <div className="flex justify-end mt-4">
                    <button onClick={onClose} className="px-5 py-2 rounded-xl text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">
                        Cerrar
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
