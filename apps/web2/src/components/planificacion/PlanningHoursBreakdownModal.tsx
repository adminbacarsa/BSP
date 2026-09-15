import React from 'react';
import { createPortal } from 'react-dom';
import { BarChart2, X } from 'lucide-react';

type Props = {
    selectedObjective: string;
    selectedGrupo: { nombre?: string; objectiveIds: string[] } | null;
    grupoUnifiedMode: boolean;
    getObjectiveName: (objectiveId: string) => string;
    breakdown: any;
    employeeMonthlyHours: Record<string, number>;
    slaVendidas: number;
    grupoTotalVendidas: number;
    auxiliarySummary: any;
    grupoObjectiveBillableHours: Record<string, number> | null;
    grupoVendidasByObjective: Record<string, number>;
    onClose: () => void;
};

export default function PlanningHoursBreakdownModal({
    selectedObjective,
    selectedGrupo,
    grupoUnifiedMode,
    getObjectiveName,
    breakdown,
    employeeMonthlyHours,
    slaVendidas,
    grupoTotalVendidas,
    auxiliarySummary,
    grupoObjectiveBillableHours,
    grupoVendidasByObjective,
    onClose,
}: Props) {
    if (typeof document === 'undefined') return null;

    const employeeTotal = Math.round(
        Object.values(employeeMonthlyHours).reduce((total, hours) => total + (hours || 0), 0),
    );
    const soldHours = selectedGrupo && grupoUnifiedMode && grupoTotalVendidas > 0
        ? grupoTotalVendidas
        : slaVendidas;
    const baseDelta = soldHours > 0 ? Math.round(breakdown.baseSla - soldHours) : 0;
    const billableDelta = soldHours > 0 ? Math.round(breakdown.gross - soldHours) : 0;
    const codes = Object.entries(breakdown.byCodeGross as Record<string, number>)
        .sort((a, b) => b[1] - a[1]);
    const groupPlannedTotal = grupoObjectiveBillableHours
        ? Math.round(Object.values(grupoObjectiveBillableHours).reduce((total, hours) => total + hours, 0))
        : 0;

    return createPortal(
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 backdrop-blur-sm no-print" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col mx-4" onClick={(event) => event.stopPropagation()}>
                <div className="p-4 border-b bg-slate-50 dark:bg-slate-800 flex justify-between items-start gap-3">
                    <div>
                        <h3 className="font-black text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <BarChart2 className="text-indigo-600" size={20}/>
                            Desglose de horas — {selectedGrupo && grupoUnifiedMode
                                ? `${selectedGrupo.nombre || 'Grupo'} (vista unificada)`
                                : getObjectiveName(selectedObjective)}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">
                            Mes calendario · Misma lógica que pre-factura (facturable) y cierre SLA (base sin ext/adel).
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl">
                        <X size={18}/>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
                    {auxiliarySummary && (auxiliarySummary.hasEnc || auxiliarySummary.hasEvt) && (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {auxiliarySummary.hasEnc && (
                                <div className="rounded-xl border border-amber-200 p-3 bg-amber-50/50">
                                    <p className="text-[9px] font-black uppercase text-amber-700">Encargado (ENC)</p>
                                    <p className="text-lg font-black text-amber-900">{auxiliarySummary.encPlanned}h <span className="text-sm font-bold text-slate-500">plan</span></p>
                                    <p className="text-[10px] text-slate-600">Techo mes: {auxiliarySummary.encContract}h · {auxiliarySummary.encInSla > 0 ? `${auxiliarySummary.encInSla}h en SLA vendido` : 'fuera de SLA vendido'}</p>
                                </div>
                            )}
                            {(auxiliarySummary.hasEvt || auxiliarySummary.evtPlanned > 0) && (
                                <div className="rounded-xl border border-violet-200 p-3 bg-violet-50/50">
                                    <p className="text-[9px] font-black uppercase text-violet-700">Eventos (EVT)</p>
                                    <p className="text-lg font-black text-violet-900">{auxiliarySummary.evtPlanned}h</p>
                                    <p className="text-[10px] text-slate-600">Prefactura / extras — no cierra SLA cobertura</p>
                                </div>
                            )}
                            <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/80">
                                <p className="text-[9px] font-black uppercase text-slate-500">SLA cobertura</p>
                                <p className="text-lg font-black text-teal-800">{soldHours || '—'}h vend.</p>
                                <p className="text-[10px] text-slate-600">Base plan {breakdown.baseSla}h · facturable {breakdown.gross}h</p>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div className="rounded-xl border border-slate-200 p-3 bg-white dark:bg-slate-800">
                            <p className="text-[9px] font-black uppercase text-slate-400">Col. legajo (CRM)</p>
                            <p className="text-xl font-black text-slate-800 dark:text-slate-100">{employeeTotal}h</p>
                            <p className="text-[10px] text-slate-500">Suma filas de la grilla</p>
                        </div>
                        <div className="rounded-xl border border-indigo-200 p-3 bg-indigo-50/50">
                            <p className="text-[9px] font-black uppercase text-indigo-600">Facturable contado</p>
                            <p className="text-xl font-black text-indigo-700">{breakdown.gross}h</p>
                            <p className="text-[10px] text-slate-500">Sin días 🚫 excluidos</p>
                        </div>
                        <div className="rounded-xl border border-teal-200 p-3 bg-teal-50/50">
                            <p className="text-[9px] font-black uppercase text-teal-700">Base cierre SLA</p>
                            <p className="text-xl font-black text-teal-800">{breakdown.baseSla}h</p>
                            <p className="text-[10px] text-slate-500">Sin ext/adel ({breakdown.coverageExtra}h aparte)</p>
                        </div>
                        <div className={`rounded-xl border p-3 ${soldHours > 0 && billableDelta !== 0 ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200 bg-white'}`}>
                            <p className="text-[9px] font-black uppercase text-slate-400">Vendidas SLA</p>
                            <p className="text-xl font-black text-teal-700">{soldHours || '—'}h</p>
                            {soldHours > 0 && (
                                <p className={`text-[10px] font-bold ${billableDelta < 0 ? 'text-rose-600' : billableDelta > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                    {billableDelta === 0
                                        ? baseDelta !== 0 && breakdown.coverageExtra > 0
                                            ? `Cierre OK (${breakdown.baseSla}h base + ${breakdown.coverageExtra}h ext)`
                                            : 'Cierre OK'
                                        : billableDelta < 0
                                            ? `Faltan ${-billableDelta}h facturables`
                                            : `+${billableDelta}h sobre vendidas`}
                                </p>
                            )}
                        </div>
                    </div>

                    {selectedGrupo && grupoUnifiedMode && grupoObjectiveBillableHours && (
                        <div className="border rounded-xl overflow-hidden">
                            <p className="text-[10px] font-black uppercase text-slate-400 px-3 py-2 bg-slate-50 dark:bg-slate-800 border-b">
                                Cierre por sede (grupo) — la suma de planificado debe igualar vendidas del grupo
                            </p>
                            <table className="w-full text-[11px]">
                                <thead className="bg-slate-100 dark:bg-slate-800">
                                    <tr>
                                        <th className="text-left p-2 font-black">Objetivo</th>
                                        <th className="text-right p-2 font-black">Facturable</th>
                                        <th className="text-right p-2 font-black">Vendidas</th>
                                        <th className="text-right p-2 font-black">Δ</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {selectedGrupo.objectiveIds.map((objectiveId) => {
                                        const planned = Math.round(grupoObjectiveBillableHours[objectiveId] || 0);
                                        const sold = Math.round(grupoVendidasByObjective[objectiveId] || 0);
                                        const delta = sold > 0 ? sold - planned : 0;
                                        return (
                                            <tr key={objectiveId} className="border-t border-slate-100">
                                                <td className="p-2 font-bold text-slate-800 truncate max-w-[220px]" title={getObjectiveName(objectiveId)}>{getObjectiveName(objectiveId)}</td>
                                                <td className="p-2 text-right font-mono">{planned}h</td>
                                                <td className="p-2 text-right font-mono text-teal-700">{sold > 0 ? `${sold}h` : '—'}</td>
                                                <td className={`p-2 text-right font-mono font-bold ${delta === 0 ? 'text-emerald-600' : delta > 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                                                    {sold <= 0 ? '—' : delta === 0 ? 'OK' : delta > 0 ? `−${delta}h` : `+${-delta}h`}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot className="bg-slate-50 font-black border-t-2">
                                    <tr>
                                        <td className="p-2">Total grupo</td>
                                        <td className="p-2 text-right font-mono">{groupPlannedTotal}h</td>
                                        <td className="p-2 text-right font-mono text-teal-700">{grupoTotalVendidas}h</td>
                                        <td className="p-2 text-right font-mono text-rose-600">
                                            {grupoTotalVendidas > 0 && groupPlannedTotal !== grupoTotalVendidas
                                                ? `−${grupoTotalVendidas - groupPlannedTotal}h`
                                                : 'OK'}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                            <p className="text-[10px] text-slate-500 px-3 py-2 border-t">
                                Cobertura «días OK» mira puestos/bandas por día; puede estar completa aunque falten horas facturables vs el SLA del mes (p. ej. códigos con menos h que el contrato).
                            </p>
                        </div>
                    )}

                    {breakdown.excludedBillable > 0 && (
                        <p className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                            {breakdown.excludedBillable}h en celdas con turno pero <b>excluidas del SLA</b> (día/puesto 🚫) — no suman a legajo ni a pre-factura.
                        </p>
                    )}
                    <p className="text-[11px] text-slate-600">
                        <b>Identidad:</b> facturable = base SLA + ext/adel ({breakdown.baseSla} + {breakdown.coverageExtra} = {Math.round((breakdown.baseSla + breakdown.coverageExtra) * 10) / 10}h).
                        {employeeTotal !== Math.round(breakdown.gross) && (
                            <span className="text-amber-700"> Diferencia col. legajo vs facturable: {employeeTotal - Math.round(breakdown.gross)}h (revisar coalesce o turnos cross-objetivo).</span>
                        )}
                    </p>

                    {codes.length > 0 && (
                        <div>
                            <p className="text-[10px] font-black uppercase text-slate-400 mb-2">Por código (facturable)</p>
                            <div className="flex flex-wrap gap-2">
                                {codes.map(([code, hours]) => (
                                    <span key={code} className="px-2 py-1 rounded-lg bg-slate-100 text-[11px] font-bold text-slate-700">{code}: {Math.round(hours)}h</span>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="border rounded-xl overflow-hidden">
                        <table className="w-full text-[11px]">
                            <thead className="bg-slate-100 dark:bg-slate-800">
                                <tr>
                                    <th className="text-left p-2 font-black">Guardia</th>
                                    <th className="text-right p-2 font-black">Col. legajo</th>
                                    <th className="text-right p-2 font-black">Facturable</th>
                                    <th className="text-right p-2 font-black">Base SLA</th>
                                    <th className="text-right p-2 font-black">Ext/adel</th>
                                    <th className="text-right p-2 font-black">Excl. 🚫</th>
                                </tr>
                            </thead>
                            <tbody>
                                {breakdown.byEmployee.map((row: any) => {
                                    const employeeHours = Math.round(employeeMonthlyHours[row.empId] || 0);
                                    return (
                                        <tr key={row.empId} className="border-t border-slate-100 hover:bg-slate-50/80">
                                            <td className="p-2 font-bold text-slate-800 truncate max-w-[200px]" title={row.name}>{row.name}</td>
                                            <td className="p-2 text-right font-mono">{employeeHours}h</td>
                                            <td className="p-2 text-right font-mono">{row.gross}h</td>
                                            <td className="p-2 text-right font-mono text-teal-700">{row.baseSla}h</td>
                                            <td className="p-2 text-right font-mono text-amber-700">{row.coverageExtra > 0 ? `+${row.coverageExtra}` : '—'}</td>
                                            <td className="p-2 text-right font-mono text-rose-600">{row.excludedBillable > 0 ? row.excludedBillable : '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot className="bg-slate-50 font-black border-t-2">
                                <tr>
                                    <td className="p-2">Total</td>
                                    <td className="p-2 text-right font-mono">{employeeTotal}h</td>
                                    <td className="p-2 text-right font-mono">{breakdown.gross}h</td>
                                    <td className="p-2 text-right font-mono text-teal-700">{breakdown.baseSla}h</td>
                                    <td className="p-2 text-right font-mono text-amber-700">+{breakdown.coverageExtra}h</td>
                                    <td className="p-2 text-right font-mono text-rose-600">{breakdown.excludedBillable || '—'}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
