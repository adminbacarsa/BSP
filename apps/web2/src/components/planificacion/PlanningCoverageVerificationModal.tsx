import React from 'react';
import { createPortal } from 'react-dom';
import type { CoverageVerificationReport } from '@/lib/planificacion/coverageVerification';
import type { ScheduleChangeSuggestion } from '@/lib/planificacion/scheduleOptimizationSuggestions';

type Props = {
    coverage: CoverageVerificationReport;
    suggestions: ScheduleChangeSuggestion[] | null;
    displayedEmployees: any[];
    onClose: () => void;
};

export default function PlanningCoverageVerificationModal({
    coverage,
    suggestions,
    displayedEmployees,
    onClose,
}: Props) {
    if (typeof document === 'undefined') return null;

    const employeeName = (empId: string) => {
        const emp = displayedEmployees.find((row: any) => row.id === empId);
        return emp?.name || emp?.nombre || empId;
    };

    return createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white p-6 rounded-xl shadow-2xl w-[900px] max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
                <h3 className="font-black text-lg mb-1 flex items-center gap-2">
                    <span className={`${coverage.ok ? 'text-emerald-600' : coverage.warnings ? 'text-amber-600' : 'text-rose-600'}`}>
                        {coverage.ok ? '✓' : coverage.warnings ? '⚠' : '✗'}
                    </span>
                    <span className="text-slate-800">Verificación de cobertura</span>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 ml-auto">
                        Resultado de la última automatización
                    </span>
                </h3>
                <p className="text-xs text-slate-500 font-medium mb-4">{coverage.summary}</p>

                <div className="grid grid-cols-4 gap-2 mb-4">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                        <p className="text-[9px] font-black text-slate-500 uppercase">Slots cubiertos</p>
                        <p className={`text-base font-black ${coverage.coverage.uncoveredSlots > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {coverage.coverage.coveredSlots} / {coverage.coverage.totalSlots}
                        </p>
                        <p className="text-[10px] text-slate-500">{Math.round(coverage.coverage.coverageRatio * 100)}%</p>
                    </div>
                    <div className={`border rounded-lg p-2 text-center ${coverage.hours.slaVendidas > 0 && coverage.hours.billableHoursGenerated < coverage.hours.slaVendidas ? 'bg-rose-50 border-rose-300' : 'bg-slate-50 border-slate-200'}`}>
                        <p className="text-[9px] font-black text-slate-500 uppercase">Hs. planificadas</p>
                        <p className={`text-base font-black ${coverage.hours.slaVendidas > 0 && coverage.hours.billableHoursGenerated < coverage.hours.slaVendidas ? 'text-rose-600' : 'text-indigo-700'}`}>
                            {Math.round(coverage.hours.billableHoursGenerated)}h
                        </p>
                        <p className="text-[10px] text-slate-500">de {Math.round(coverage.hours.slaVendidas)}h vendidas</p>
                    </div>
                    <div className={`border rounded-lg p-2 text-center ${coverage.hours.deltaPct < 0 ? 'bg-rose-50 border-rose-300' : coverage.hours.deltaPct > 0.05 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                        <p className="text-[9px] font-black text-slate-500 uppercase">Cierre</p>
                        <p className={`text-base font-black ${coverage.hours.deltaPct < 0 ? 'text-rose-600' : coverage.hours.deltaPct > 0.05 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {coverage.hours.deltaPct >= 0 ? '+' : ''}{(coverage.hours.deltaPct * 100).toFixed(1)}%
                        </p>
                        <p className="text-[10px] text-slate-500">
                            {coverage.hours.deltaPct < 0
                                ? `−${Math.round(coverage.hours.slaVendidas - coverage.hours.billableHoursGenerated)}h`
                                : '≥ vendidas ✓'}
                        </p>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                        <p className="text-[9px] font-black text-slate-500 uppercase">Conflictos duros</p>
                        <p className={`text-base font-black ${(coverage.restViolations.length + coverage.licenseConflicts.length) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {coverage.restViolations.length + coverage.licenseConflicts.length}
                        </p>
                        <p className="text-[10px] text-slate-500">descansos + licencias</p>
                    </div>
                </div>

                {suggestions && suggestions.length > 0 && (
                    <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
                        <h4 className="font-black text-sm text-indigo-800 mb-2">Sugerencias de optimización ({suggestions.length})</h4>
                        <ul className="max-h-40 overflow-y-auto space-y-1.5 text-[11px] text-slate-700">
                            {suggestions.slice(0, 40).map((suggestion, index) => (
                                <li
                                    key={`${suggestion.code}_${index}`}
                                    className={
                                        suggestion.severity === 'error'
                                            ? 'text-rose-800 font-semibold'
                                            : suggestion.severity === 'warning'
                                                ? 'text-amber-900'
                                                : 'text-slate-600'
                                    }
                                >
                                    <span className="font-mono text-[9px] uppercase text-indigo-500 mr-1">{suggestion.code}</span>
                                    {suggestion.message}
                                </li>
                            ))}
                        </ul>
                        {suggestions.length > 40 && (
                            <p className="text-[10px] text-slate-500 mt-1">Mostrando 40 de {suggestions.length}.</p>
                        )}
                    </div>
                )}

                {coverage.uncovered.length > 0 && (
                    <div className="mb-4">
                        <h4 className="font-black text-sm text-rose-700 mb-2">Slots sin cubrir ({coverage.uncovered.length})</h4>
                        <div className="max-h-48 overflow-y-auto rounded-lg border border-rose-200">
                            <table className="w-full text-[11px]">
                                <thead className="bg-rose-50 text-rose-800 sticky top-0">
                                    <tr>
                                        <th className="text-left px-2 py-1.5 font-black uppercase">Fecha</th>
                                        <th className="text-left px-2 py-1.5 font-black uppercase">Día</th>
                                        <th className="text-left px-2 py-1.5 font-black uppercase">Puesto</th>
                                        <th className="text-left px-2 py-1.5 font-black uppercase">Turno</th>
                                        <th className="text-right px-2 py-1.5 font-black uppercase">Faltan</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {coverage.uncovered.slice(0, 200).map((slot, index) => (
                                        <tr key={index} className="border-t border-rose-100">
                                            <td className="px-2 py-1 font-mono text-slate-700">{slot.dateStr}</td>
                                            <td className="px-2 py-1 text-slate-500">{slot.dayLetter}</td>
                                            <td className="px-2 py-1 text-slate-700">{slot.positionName}</td>
                                            <td className="px-2 py-1 font-bold text-slate-800">{slot.shiftCode}</td>
                                            <td className="px-2 py-1 text-right font-mono text-rose-700">{slot.qtyRequested - slot.qtyAssigned} / {slot.qtyRequested}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {coverage.uncovered.length > 200 && (
                            <p className="text-[10px] text-slate-400 mt-1">Mostrando primeros 200 de {coverage.uncovered.length}.</p>
                        )}
                    </div>
                )}

                {coverage.restViolations.length > 0 && (
                    <div className="mb-4">
                        <h4 className="font-black text-sm text-rose-700 mb-2">Descansos rotos ({coverage.restViolations.length})</h4>
                        <div className="max-h-40 overflow-y-auto rounded-lg border border-rose-200">
                            <table className="w-full text-[11px]">
                                <thead className="bg-rose-50 text-rose-800 sticky top-0">
                                    <tr>
                                        <th className="text-left px-2 py-1.5 font-black uppercase">Empleado</th>
                                        <th className="text-left px-2 py-1.5 font-black uppercase">Fecha</th>
                                        <th className="text-left px-2 py-1.5 font-black uppercase">Turno</th>
                                        <th className="text-left px-2 py-1.5 font-black uppercase">Motivo</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {coverage.restViolations.slice(0, 100).map((violation, index) => (
                                        <tr key={index} className="border-t border-rose-100">
                                            <td className="px-2 py-1 text-slate-700">{employeeName(violation.empId)}</td>
                                            <td className="px-2 py-1 font-mono text-slate-700">{violation.dateStr}</td>
                                            <td className="px-2 py-1 font-bold text-slate-800">{violation.shiftSchedule || violation.shiftCode}</td>
                                            <td className="px-2 py-1 text-rose-700 text-[10px]">{violation.reason}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {coverage.licenseConflicts.length > 0 && (
                    <div className="mb-4">
                        <h4 className="font-black text-sm text-rose-700 mb-2">Conflictos con licencias ({coverage.licenseConflicts.length})</h4>
                        <div className="max-h-32 overflow-y-auto rounded-lg border border-rose-200">
                            <table className="w-full text-[11px]">
                                <thead className="bg-rose-50 text-rose-800 sticky top-0">
                                    <tr>
                                        <th className="text-left px-2 py-1.5 font-black uppercase">Empleado</th>
                                        <th className="text-left px-2 py-1.5 font-black uppercase">Fecha</th>
                                        <th className="text-left px-2 py-1.5 font-black uppercase">Turno</th>
                                        <th className="text-left px-2 py-1.5 font-black uppercase">Licencia</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {coverage.licenseConflicts.map((conflict, index) => (
                                        <tr key={index} className="border-t border-rose-100">
                                            <td className="px-2 py-1 text-slate-700">{employeeName(conflict.empId)}</td>
                                            <td className="px-2 py-1 font-mono text-slate-700">{conflict.dateStr}</td>
                                            <td className="px-2 py-1 font-bold text-slate-800">{conflict.shiftCode}</td>
                                            <td className="px-2 py-1 font-bold text-amber-700">{conflict.absenceCode}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {coverage.overHours.length > 0 && (
                    <div className="mb-4">
                        <h4 className="font-black text-sm text-amber-700 mb-2">Empleados &gt; 200h por ciclo ({coverage.overHours.length})</h4>
                        <div className="max-h-32 overflow-y-auto rounded-lg border border-amber-200">
                            <table className="w-full text-[11px]">
                                <thead className="bg-amber-50 text-amber-800 sticky top-0">
                                    <tr>
                                        <th className="text-left px-2 py-1.5 font-black uppercase">Empleado</th>
                                        <th className="text-left px-2 py-1.5 font-black uppercase">Ciclo</th>
                                        <th className="text-right px-2 py-1.5 font-black uppercase">Horas</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {coverage.overHours.map((row, index) => (
                                        <tr key={index} className="border-t border-amber-100">
                                            <td className="px-2 py-1 text-slate-700">{employeeName(row.empId)}</td>
                                            <td className="px-2 py-1 font-bold text-slate-800">{row.cycle === 'current' ? 'Actual' : 'Siguiente'}</td>
                                            <td className="px-2 py-1 text-right font-mono text-amber-700">{Math.round(row.hours)}h</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                <div className="bg-slate-50 rounded-lg p-3 text-[11px] text-slate-600 mb-3">
                    <div className="font-black text-slate-700 mb-1">Cómo interpretar</div>
                    <ul className="space-y-0.5 list-disc list-inside">
                        <li><b className="text-rose-700">Slots sin cubrir</b>: hay menos personas que las pedidas por SLA. Subí dotación o pasá puestos a 12h para reducir slots.</li>
                        <li><b className="text-rose-700">Descansos rotos</b>: el motor no debería generar esto. Si aparece, marcá la línea y avisá al equipo.</li>
                        <li><b className="text-rose-700">Conflictos con licencias</b>: empleado asignado en día con ausencia activa. Generalmente indica una licencia agregada después de planificar.</li>
                        <li><b className="text-amber-700">&gt;200h</b>: revisá si conviene mover horas al ciclo siguiente.</li>
                    </ul>
                </div>

                <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-slate-500">
                        {coverage.ok
                            ? 'Cobertura sin errores duros. Podés guardar.'
                            : `Se detectaron ${coverage.uncovered.length} slots, ${coverage.restViolations.length} descansos y ${coverage.licenseConflicts.length} conflictos.`}
                    </div>
                    <button onClick={onClose} className="px-5 py-2 rounded-xl text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">
                        Cerrar
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
