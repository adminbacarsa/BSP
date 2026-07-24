import React from 'react';
import type { CoverageVerificationReport } from '@/lib/planificacion/coverageVerification';
import type { AbsenceSplitAction } from '@/lib/planificacion/absenceSplitCoverage';
import type { AbsenceCoveragePlan } from '@/lib/planificacion/absenceCoveragePlanner';
import { ABSENCE_COVERAGE_STRATEGY_LABELS } from '@/lib/planificacion/absenceCoveragePlanner';
import { ABSENCE_COVERAGE_PRIORITY_SUMMARY } from '@/lib/planificacion/planningCoveragePolicy';
import type { FixerLogEntry, FixerResult } from '@/lib/planificacion/coverageFixer';
import type { V2EmployeeDef } from '@/lib/planificacion/autoScheduleEngineV2';
import type { ExternalRetAction } from '@/lib/planificacion/externalRetCoverage';
import { shortExternalRetLabel } from '@/lib/planificacion/externalRetCoverage';
import { AlertTriangle, CheckCircle2, ShieldCheck, UserCheck, XCircle } from 'lucide-react';

interface AutoLabCoveragePanelProps {
    report: CoverageVerificationReport | null;
    employees: V2EmployeeDef[];
    absenceCoverageGaps?: CoverageGap[];
    absenceSplitActions?: AbsenceSplitAction[];
    absenceCoveragePlan?: AbsenceCoveragePlan | null;
    externalRetActions?: ExternalRetAction[];
    fixerLog?: FixerLogEntry[];
    fixerSummary?: FixerResult['summary'];
}

function empLabel(employees: V2EmployeeDef[], empId: string): string {
    const e = employees.find((x) => x.id === empId);
    if (!e) return empId;
    return shortExternalRetLabel(e);
}

export default function AutoLabCoveragePanel({
    report,
    employees,
    absenceCoverageGaps = [],
    absenceSplitActions = [],
    absenceCoveragePlan = null,
    externalRetActions = [],
    fixerLog = [],
    fixerSummary,
}: AutoLabCoveragePanelProps) {
    if (!report) {
        return (
            <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5 text-sm text-slate-500">
                Sin verificación de cobertura (cronograma no generado).
            </div>
        );
    }

    const pct = Math.round(report.coverage.coverageRatio * 1000) / 10;
    const coveredAbsences = absenceCoverageGaps.filter((g) => g.coveredBy);
    const ftPending = absenceCoverageGaps.filter((g) => g.coverageType === 'ft_required');
    const replacementLog = fixerLog.filter((e) =>
        ['license_cover', 'uncovered_fill', 'band_rebalance'].includes(e.issueType),
    );

    return (
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-emerald-50 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <ShieldCheck size={18} className="text-emerald-700" />
                    <div>
                        <h2 className="font-black text-slate-800 text-sm uppercase tracking-wide">
                            Verificación de coberturas
                        </h2>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                            Slots SLA vs asignaciones · descansos · licencias
                        </p>
                    </div>
                </div>
                {report.ok ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-1 text-xs font-black uppercase">
                        <CheckCircle2 size={14} />
                        Todo cerrado
                    </span>
                ) : report.warnings ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200 px-3 py-1 text-xs font-black uppercase">
                        <AlertTriangle size={14} />
                        Con avisos
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 text-red-800 border border-red-200 px-3 py-1 text-xs font-black uppercase">
                        <XCircle size={14} />
                        Huecos / conflictos
                    </span>
                )}
            </div>

            <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                        <p className="font-black uppercase text-emerald-700 text-[10px]">Cobertura SLA</p>
                        <p className="font-black text-emerald-900 text-lg mt-1">
                            {report.coverage.coveredSlots}/{report.coverage.totalSlots}
                        </p>
                        <p className="text-[10px] text-emerald-700 mt-0.5">{pct}% cerrado</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="font-black uppercase text-slate-500 text-[10px]">Huecos</p>
                        <p className={`font-black text-lg mt-1 ${report.coverage.uncoveredSlots > 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                            {report.coverage.uncoveredSlots}
                        </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="font-black uppercase text-slate-500 text-[10px]">Horas facturables</p>
                        <p className="font-black text-slate-800 text-lg mt-1">
                            {Math.round(report.hours.billableHoursGenerated)}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">SLA {Math.round(report.hours.slaVendidas)} h</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="font-black uppercase text-slate-500 text-[10px]">Modalidad</p>
                        <p className="font-bold text-slate-800 mt-1">
                            {report.modality.cycleType} · {report.modality.bandsExpected.join('/')}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{report.modality.cycles.join(', ')}</p>
                    </div>
                </div>

                <p className="text-sm text-slate-700 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    {report.summary}
                    {fixerSummary && fixerSummary.uncoveredFixed > 0 && (
                        <span className="block mt-1 text-emerald-800 font-semibold">
                            Autocorrección: {fixerSummary.uncoveredFixed} hueco(s) cubierto(s) con reemplazos del objetivo.
                        </span>
                    )}
                </p>

                {absenceCoveragePlan && absenceCoveragePlan.days.length > 0 && (
                    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-3 space-y-3">
                        <div>
                            <p className="text-xs font-black uppercase text-violet-900">
                                Estrategia V/L/E (orden COSP)
                            </p>
                            <p className="text-[10px] text-violet-800 mt-1">
                                {ABSENCE_COVERAGE_PRIORITY_SUMMARY}
                            </p>
                            <p className="text-sm text-violet-950 mt-2 font-semibold">
                                {absenceCoveragePlan.summary}
                            </p>
                        </div>
                        {absenceCoveragePlan.periods.length > 0 && (
                            <ul className="space-y-2 text-[11px] text-violet-950 max-h-40 overflow-y-auto">
                                {absenceCoveragePlan.periods.map((p) => (
                                    <li
                                        key={`${p.absentEmpId}-${p.startDate}`}
                                        className="rounded-lg border border-violet-200 bg-white/70 px-3 py-2"
                                    >
                                        <span className="font-bold">
                                            {empLabel(employees, p.absentEmpId)} · {p.absenceCode}
                                            {' '}{p.startDate.slice(8, 10)}/{p.startDate.slice(5, 7)}
                                            {p.startDate !== p.endDate && (
                                                <> → {p.endDate.slice(8, 10)}/{p.endDate.slice(5, 7)}</>
                                            )}
                                            {' '}({p.workDaysNeedingCover}d cobertura)
                                        </span>
                                        <span className={`ml-2 font-black uppercase text-[10px] ${
                                            p.strategySummary === 'ft_last_resort'
                                                ? 'text-orange-700'
                                                : p.strategySummary === 'external_ret'
                                                    ? 'text-rose-700'
                                                    : 'text-emerald-700'
                                        }`}>
                                            {ABSENCE_COVERAGE_STRATEGY_LABELS[p.strategySummary]}
                                        </span>
                                        {p.messages.map((m) => (
                                            <p key={m} className="text-[10px] text-violet-800 mt-0.5">{m}</p>
                                        ))}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {(absenceSplitActions.length > 0 || coveredAbsences.length > 0 || externalRetActions.length > 0 || replacementLog.length > 0) && (
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
                        <p className="text-xs font-black uppercase text-indigo-800 mb-2 flex items-center gap-1">
                            <UserCheck size={12} />
                            Reemplazos aplicados
                        </p>
                        <ul className="space-y-1 max-h-36 overflow-y-auto text-[11px] text-indigo-950">
                            {absenceSplitActions.map((s) => (
                                <li key={`split-${s.dateStr}-${s.positionName}-${s.absentEmpId}`}>
                                    {s.dateStr} · {s.positionName}
                                    {' — ausente '}{empLabel(employees, s.absentEmpId)}
                                    {s.absentBand ? ` (${s.absentBand})` : ''}
                                    {' → '}
                                    <strong>{empLabel(employees, s.d12EmpId)} D12</strong>
                                    {' + '}
                                    <strong>{empLabel(employees, s.n12EmpId)} N12</strong>
                                    <span className="text-indigo-700"> (extensión 12h)</span>
                                </li>
                            ))}
                            {coveredAbsences.map((g) => (
                                <li key={`abs-${g.absentEmpId}-${g.dateStr}-${g.band}`}>
                                    {g.dateStr} · {empLabel(employees, g.absentEmpId)} ausente ({g.band})
                                    {' → '}
                                    <strong>{empLabel(employees, g.coveredBy!)}</strong>
                                    {' '}({g.coverageType === 'sin_turno' ? 'libre' : g.coverageType?.toUpperCase()})
                                </li>
                            ))}
                            {externalRetActions.map((a) => (
                                <li key={`ext-${a.dateStr}-${a.band}-${a.empId}`}>
                                    {a.dateStr} · <strong>{empLabel(employees, a.empId)} {a.band}</strong>
                                    {a.modo === 'modo8_internal' && (
                                        <span className="text-emerald-700"> · RET interno activado (sobra capacidad)</span>
                                    )}
                                    {a.modo === 'modo8_external' && (
                                        <span className="text-violet-700"> · RET externo Modo 8</span>
                                    )}
                                    {a.modo === 'modo12' && (
                                        <span className="text-amber-700"> · contingencia 12h</span>
                                    )}
                                </li>
                            ))}
                            {replacementLog.slice(0, 10).map((e, i) => (
                                <li key={`fix-${e.empId}-${e.dateStr}-${i}`}>
                                    {empLabel(employees, e.empId)} · {e.dateStr}: {e.detail}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {ftPending.length > 0 && (
                    <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-3">
                        <p className="text-xs font-black uppercase text-orange-800 mb-2">
                            Último recurso: franco trabajado (FT) — {ftPending.length}
                        </p>
                        <p className="text-[10px] text-orange-900 mb-2">
                            Solo si no alcanza extensión 12h ni RET. Costo doble CCT (franco + jornada). Asignación manual.
                        </p>
                        <ul className="space-y-1 text-[11px] text-orange-950 max-h-24 overflow-y-auto">
                            {ftPending.slice(0, 8).map((g) => (
                                <li key={`ft-${g.absentEmpId}-${g.dateStr}`}>
                                    {g.dateStr} · {empLabel(employees, g.absentEmpId)} · {g.band}
                                    {g.ftCandidates?.length ? ` · ${g.ftCandidates.length} candidato(s) F` : ''}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {report.uncovered.length > 0 && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
                        <p className="text-xs font-black uppercase text-rose-800 mb-2">
                            Slots sin cubrir ({report.uncovered.length})
                        </p>
                        <ul className="space-y-1 max-h-32 overflow-y-auto text-[11px] text-rose-950">
                            {report.uncovered.slice(0, 12).map((u) => (
                                <li key={`${u.dateStr}-${u.positionName}-${u.shiftCode}`}>
                                    {u.dateStr} · {u.positionName} · {u.shiftCode}
                                    {' '}(faltan {u.qtyRequested - u.qtyAssigned})
                                </li>
                            ))}
                            {report.uncovered.length > 12 && (
                                <li className="text-rose-600 font-bold">+{report.uncovered.length - 12} más…</li>
                            )}
                        </ul>
                    </div>
                )}

                {(report.licenseConflicts.length > 0 || report.restViolations.length > 0) && (
                    <div className="grid md:grid-cols-2 gap-2 text-[11px]">
                        {report.licenseConflicts.length > 0 && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                                <p className="font-black uppercase text-amber-800 mb-1">
                                    Licencia + turno ({report.licenseConflicts.length})
                                </p>
                                {report.licenseConflicts.slice(0, 5).map((c) => (
                                    <p key={`${c.empId}-${c.dateStr}`} className="text-amber-950">
                                        {empLabel(employees, c.empId)} {c.dateStr}: {c.absenceCode} vs {c.shiftCode}
                                    </p>
                                ))}
                            </div>
                        )}
                        {report.restViolations.length > 0 && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                                <p className="font-black uppercase text-amber-800 mb-1">
                                    Descanso CCT ({report.restViolations.length})
                                </p>
                                {report.restViolations.slice(0, 5).map((v) => (
                                    <p key={`${v.empId}-${v.dateStr}`} className="text-amber-950">
                                        <span className="font-bold">{empLabel(employees, v.empId)} {v.dateStr}</span>
                                        {v.shiftSchedule && (
                                            <span className="text-amber-800"> · {v.shiftSchedule}</span>
                                        )}
                                        <br />
                                        <span className="text-[10px]">{v.reason}</span>
                                    </p>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
