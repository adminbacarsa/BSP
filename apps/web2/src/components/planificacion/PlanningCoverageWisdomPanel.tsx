import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
    BookOpen,
    Building2,
    CalendarDays,
    Copy,
    ExternalLink,
    Loader2,
    RefreshCw,
    Search,
    Target,
    Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useEmpresa } from '@/context/EmpresaContext';
import { useObjectivePlanningCatalog } from '@/hooks/useObjectivePlanningCatalog';
import { fetchPlanningMonthAbsences, fetchPlanningMonthShifts, previousCalendarMonth } from '@/lib/planificacion/loadPlanningMonthShifts';
import {
    COVERAGE_STRATEGY_LABELS,
    extractPlanningCoverageWisdom,
    rankCoverersFromWisdom,
    type PlanningAbsenceRecord,
    type PlanningCoverageWisdom,
    type PlanningShiftCell,
} from '@/lib/planificacion/planningCoverageWisdom';
import {
    countCachedWisdomEntries,
    loadLastObjectiveId,
    loadWisdomForObjective,
    saveWisdomEntry,
} from '@/lib/planificacion/planningWisdomStorage';
import {
    buildPlanningPositionStructure,
    formatSlaRangeHint,
    pickSlaForPlanningMonth,
    planningMonthHasActiveSla,
} from '@/lib/slaPlanningMatch';

function formatExtractedAt(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const COVERAGE_LABELS: Record<string, string> = {
    '24hs': '24 horas',
    '12hs_diurno': '12h diurno',
    '12hs_nocturno': '12h nocturno',
    custom: 'Personalizado',
};

const ABSENCE_GRID_CODES = new Set(['V', 'L', 'E', 'A', 'PG', 'AA']);

type ScheduleSnapshot = {
    cells: number;
    employees: number;
    days: number;
    draftCount: number;
    absenceInTurnos: number;
    absencesRrhh: number;
    byCode: Record<string, number>;
};

function buildScheduleSnapshot(
    cells: PlanningShiftCell[],
    absences: PlanningAbsenceRecord[],
): ScheduleSnapshot {
    const byCode: Record<string, number> = {};
    let absenceInTurnos = 0;
    for (const c of cells) {
        const code = String(c.code || '').toUpperCase().trim() || '?';
        byCode[code] = (byCode[code] || 0) + 1;
        if (ABSENCE_GRID_CODES.has(code)) absenceInTurnos++;
    }
    return {
        cells: cells.length,
        employees: new Set(cells.map((c) => c.employeeId)).size,
        days: new Set(cells.map((c) => c.dateStr)).size,
        draftCount: cells.filter((c) => c.draft).length,
        absenceInTurnos,
        absencesRrhh: absences.length,
        byCode,
    };
}

export interface PlanningCoverageWisdomPanelProps {
    defaultObjectiveId?: string;
    labYear?: number;
    labMonth?: number;
    suggestBand?: string;
    suggestAbsentCode?: string;
}

export default function PlanningCoverageWisdomPanel({
    defaultObjectiveId = '',
    labYear,
    labMonth,
    suggestBand,
    suggestAbsentCode,
}: PlanningCoverageWisdomPanelProps) {
    const { empresaId } = useEmpresa();
    const { objectives, getSlasForObjective, objectivesWithSla, loading: loadingCatalog } =
        useObjectivePlanningCatalog(empresaId);

    const prev = useMemo(() => {
        const y = labYear ?? new Date().getFullYear();
        const m = labMonth ?? new Date().getMonth() + 1;
        return previousCalendarMonth(y, m);
    }, [labYear, labMonth]);

    const [search, setSearch] = useState('');
    const [selectedKey, setSelectedKey] = useState('');
    const [year, setYear] = useState(prev.year);
    const [month, setMonth] = useState(prev.month);
    const [loading, setLoading] = useState(false);
    const [wisdom, setWisdom] = useState<PlanningCoverageWisdom | null>(null);
    const [scheduleSnapshot, setScheduleSnapshot] = useState<ScheduleSnapshot | null>(null);
    const [cachedCount, setCachedCount] = useState(0);

    const selectedObjective = useMemo(() => {
        if (!selectedKey) return null;
        return objectives.find((o) => `${o.clientId}::${o.objectiveId}` === selectedKey) ?? null;
    }, [objectives, selectedKey]);

    useEffect(() => {
        setCachedCount(countCachedWisdomEntries());
    }, [wisdom]);

    useEffect(() => {
        if (objectives.length === 0) return;
        const preferred =
            (defaultObjectiveId &&
                objectives.find((o) => o.objectiveId === defaultObjectiveId)) ||
            objectives.find(
                (o) => o.objectiveId === loadLastObjectiveId(),
            ) ||
            objectives[0];
        if (!preferred) return;
        const key = `${preferred.clientId}::${preferred.objectiveId}`;
        setSelectedKey((current) => current || key);
    }, [objectives, defaultObjectiveId]);

    useEffect(() => {
        if (!selectedObjective) {
            setWisdom(null);
            setScheduleSnapshot(null);
            return;
        }
        setWisdom(loadWisdomForObjective(selectedObjective.objectiveId));
    }, [selectedObjective?.objectiveId, selectedObjective]);

    const filteredObjectives = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return objectives;
        return objectives.filter((o) => {
            const hay = `${o.clientName} ${o.objectiveName} ${o.objectiveId}`.toLowerCase();
            return hay.includes(q);
        });
    }, [objectives, search]);

    const objectiveSlas = useMemo(() => {
        if (!selectedObjective) return [];
        return getSlasForObjective(selectedObjective.clientId, selectedObjective.objectiveId);
    }, [selectedObjective, getSlasForObjective]);

    const slaForMonth = useMemo(() => {
        if (!selectedObjective || objectiveSlas.length === 0) {
            return { vigente: null, hasExactMatch: false, fallback: null, monthHasSla: false, structure: [] as ReturnType<typeof buildPlanningPositionStructure>['structure'] };
        }
        const { vigente, hasExactMatch, fallback } = pickSlaForPlanningMonth(objectiveSlas, year, month - 1);
        const monthHasSla = planningMonthHasActiveSla(objectiveSlas, year, month - 1);
        const srv = vigente ?? fallback;
        const { structure } = buildPlanningPositionStructure(srv, { monthHasSla, hasExactMatch });
        return { vigente: srv, hasExactMatch, fallback, monthHasSla, structure };
    }, [selectedObjective, objectiveSlas, year, month]);

    const loadWisdom = useCallback(async () => {
        if (!selectedObjective) {
            toast.error('Seleccioná un objetivo');
            return;
        }
        if (!empresaId) {
            toast.error('Sin empresa activa');
            return;
        }
        setLoading(true);
        try {
            const cells = await fetchPlanningMonthShifts({
                empresaId,
                objectiveId: selectedObjective.objectiveId,
                year,
                month,
            });
            const rosterEmployeeIds = new Set(cells.map((c) => c.employeeId));
            const absences = await fetchPlanningMonthAbsences({
                empresaId,
                year,
                month,
                rosterEmployeeIds,
            });
            const extracted = extractPlanningCoverageWisdom(cells, {
                objectiveId: selectedObjective.objectiveId,
                year,
                month,
                absences,
            });
            const snapshot = buildScheduleSnapshot(cells, absences);
            setScheduleSnapshot(snapshot);
            setWisdom(extracted);
            saveWisdomEntry(extracted);
            setCachedCount(countCachedWisdomEntries());
            const draftCount = cells.filter((c) => c.draft).length;
            const publishedCount = cells.length - draftCount;
            toast.success(
                cells.length > 0 || absences.length > 0
                    ? `Sabiduría: ${extracted.events.length} cobertura(s) · ${cells.length} celdas (${draftCount} borrador · ${publishedCount} publicado) · ${absences.length} ausencia(s) RRHH`
                    : 'Sin turnos ni ausencias en ese período — probá otro mes u objetivo',
            );
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Error al cargar cronograma');
        } finally {
            setLoading(false);
        }
    }, [selectedObjective, empresaId, year, month]);

    const suggestedCoverers = useMemo(() => {
        if (!wisdom || !suggestBand) return [];
        return rankCoverersFromWisdom(wisdom, suggestBand, {
            absentCode: suggestAbsentCode,
            limit: 5,
        });
    }, [wisdom, suggestBand, suggestAbsentCode]);

    const copyJson = () => {
        if (!wisdom) return;
        void navigator.clipboard.writeText(JSON.stringify(wisdom, null, 2));
        toast.success('JSON de sabiduría copiado');
    };

    const periodLabel = `${MONTH_NAMES[month - 1]} ${year}`;

    return (
        <div className="rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-50/80 to-white p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-black text-indigo-900 flex items-center gap-2">
                        <BookOpen size={16} />
                        Sabiduría de coberturas
                    </h3>
                    <p className="text-xs text-indigo-800/80 mt-1 max-w-2xl">
                        Lee el cronograma <strong>real</strong> de Firestore (no la grilla simulada de arriba).
                        Busca <em>quién cubrió a quién</em> cuando hubo ausencias V/L/E — no muestra el crono completo.
                        Para ver y editar la grilla: <strong>Planificación</strong>.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                    <span className="rounded-lg bg-white border border-slate-200 px-2 py-1 text-slate-700">
                        {loadingCatalog ? '…' : `${objectives.length} objetivo(s)`}
                    </span>
                    <span className="rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-1 text-emerald-800">
                        {objectivesWithSla} con SLA
                    </span>
                    <span className="rounded-lg bg-indigo-50 border border-indigo-200 px-2 py-1 text-indigo-800">
                        {cachedCount} en memoria local
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <div className="lg:col-span-2 space-y-2">
                    <label className="block relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar cliente u objetivo…"
                            className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-xs font-medium"
                        />
                    </label>
                    <div className="rounded-2xl border border-slate-200 bg-white max-h-64 overflow-y-auto shadow-sm">
                        {loadingCatalog ? (
                            <p className="p-4 text-xs text-slate-500 flex items-center gap-2">
                                <Loader2 size={14} className="animate-spin" />
                                Cargando objetivos…
                            </p>
                        ) : filteredObjectives.length === 0 ? (
                            <p className="p-4 text-xs text-slate-500">
                                No hay objetivos activos para esta empresa.
                            </p>
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {filteredObjectives.map((obj) => {
                                    const key = `${obj.clientId}::${obj.objectiveId}`;
                                    const slaCount = getSlasForObjective(obj.clientId, obj.objectiveId).length;
                                    const hasCache = !!loadWisdomForObjective(obj.objectiveId);
                                    const isSelected = selectedKey === key;
                                    return (
                                        <li key={key}>
                                            <button
                                                type="button"
                                                onClick={() => setSelectedKey(key)}
                                                className={`w-full text-left px-3 py-2.5 transition-colors ${
                                                    isSelected
                                                        ? 'bg-indigo-50 border-l-4 border-indigo-600'
                                                        : 'hover:bg-slate-50 border-l-4 border-transparent'
                                                }`}
                                            >
                                                <p className="text-xs font-black text-slate-800 truncate">
                                                    {obj.objectiveName}
                                                </p>
                                                <p className="text-[10px] text-slate-500 truncate flex items-center gap-1">
                                                    <Building2 size={10} />
                                                    {obj.clientName}
                                                </p>
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                    {slaCount > 0 ? (
                                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                                                            {slaCount} SLA
                                                        </span>
                                                    ) : (
                                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200">
                                                            sin SLA
                                                        </span>
                                                    )}
                                                    {hasCache && (
                                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200">
                                                            memoria
                                                        </span>
                                                    )}
                                                </div>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>

                <div className="lg:col-span-3 space-y-4">
                    {selectedObjective ? (
                        <>
                            <div className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm space-y-3">
                                <div className="flex items-start gap-2">
                                    <Target size={16} className="text-indigo-600 shrink-0 mt-0.5" />
                                    <div className="min-w-0">
                                        <p className="text-sm font-black text-slate-800">{selectedObjective.objectiveName}</p>
                                        <p className="text-xs text-slate-600">{selectedObjective.clientName}</p>
                                        <p className="text-[10px] font-mono text-slate-400 mt-0.5">{selectedObjective.objectiveId}</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <label className="block">
                                        <span className="text-[10px] font-black uppercase text-slate-500">Mes referencia</span>
                                        <select
                                            value={month}
                                            onChange={(e) => setMonth(Number(e.target.value))}
                                            className="mt-1 w-full rounded-xl border border-slate-200 px-2 py-1.5 text-xs font-bold"
                                        >
                                            {MONTH_NAMES.map((name, i) => (
                                                <option key={name} value={i + 1}>{name}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block">
                                        <span className="text-[10px] font-black uppercase text-slate-500">Año</span>
                                        <input
                                            type="number"
                                            value={year}
                                            onChange={(e) => setYear(Number(e.target.value))}
                                            className="mt-1 w-full rounded-xl border border-slate-200 px-2 py-1.5 text-xs font-bold"
                                        />
                                    </label>
                                </div>
                                <p className="text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                    Lee turnos en <strong>borrador</strong> y publicados. Extraer analiza ausencias y coberturas;
                                    no abre la grilla del mes (eso está en Planificación).
                                </p>
                                {selectedObjective && (
                                    <Link
                                        href="/admin/planificacion"
                                        className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 hover:text-indigo-900"
                                    >
                                        <ExternalLink size={12} />
                                        Abrir Planificación para ver/editar el cronograma de {selectedObjective.objectiveName}
                                    </Link>
                                )}
                            </div>

                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm space-y-3">
                                <p className="text-[10px] font-black uppercase text-emerald-900 flex items-center gap-1">
                                    Servicio real (SLA) — {periodLabel}
                                </p>
                                {objectiveSlas.length === 0 ? (
                                    <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                        Sin contratos en <strong>Servicios</strong> vinculados a este objetivo.
                                        Revisá CRM → objetivo y módulo Servicios.
                                    </p>
                                ) : !slaForMonth.monthHasSla ? (
                                    <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                        Sin SLA vigente para {periodLabel}.
                                        Contratos del objetivo: {formatSlaRangeHint(objectiveSlas) || '—'}
                                    </p>
                                ) : (
                                    <>
                                        <p className="text-xs font-semibold text-emerald-900">
                                            Contrato: {slaForMonth.vigente?.clientName || selectedObjective.clientName}
                                            {' · '}
                                            {slaForMonth.vigente?.startDate} → {slaForMonth.vigente?.endDate}
                                            {slaForMonth.vigente?.totalMonthlyHours
                                                ? ` · ${slaForMonth.vigente.totalMonthlyHours}h/mes`
                                                : ''}
                                        </p>
                                        {slaForMonth.structure.length > 0 ? (
                                            <div className="overflow-x-auto rounded-xl border border-emerald-200 bg-white">
                                                <table className="w-full text-xs">
                                                    <thead className="bg-emerald-50/80 text-emerald-900 font-black uppercase text-[10px]">
                                                        <tr>
                                                            <th className="text-left p-2">Puesto</th>
                                                            <th className="text-center p-2">Pax</th>
                                                            <th className="text-left p-2">Cobertura</th>
                                                            <th className="text-left p-2">Bandas</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {slaForMonth.structure.map((pos) => (
                                                            <tr key={pos.positionName} className="border-t border-slate-100">
                                                                <td className="p-2 font-bold text-slate-800">{pos.positionName}</td>
                                                                <td className="p-2 text-center font-black text-indigo-700">{pos.qty}</td>
                                                                <td className="p-2 text-slate-600">
                                                                    {COVERAGE_LABELS[pos.coverageType] || pos.coverageType}
                                                                </td>
                                                                <td className="p-2 text-slate-700 font-mono text-[11px]">
                                                                    {(pos.shifts || [])
                                                                        .map((s) => s.code)
                                                                        .filter(Boolean)
                                                                        .join(' · ') || 'M · T · N'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-slate-600">Contrato sin puestos configurados.</p>
                                        )}
                                    </>
                                )}
                                {objectiveSlas.length > 1 && (
                                    <details className="text-[11px] text-slate-600">
                                        <summary className="cursor-pointer font-bold">
                                            {objectiveSlas.length} contratos históricos
                                        </summary>
                                        <ul className="mt-2 space-y-1 pl-2">
                                            {objectiveSlas.map((s) => (
                                                <li key={s.id}>
                                                    {s.startDate} → {s.endDate}
                                                    {' · '}
                                                    {s.status || 'active'}
                                                    {s.positions?.length ? ` · ${s.positions.length} puesto(s)` : ''}
                                                </li>
                                            ))}
                                        </ul>
                                    </details>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => void loadWisdom()}
                                    disabled={loading}
                                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                    Extraer del cronograma
                                </button>
                                {wisdom && (
                                    <button
                                        type="button"
                                        onClick={copyJson}
                                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                                    >
                                        <Copy size={12} />
                                        Exportar JSON
                                    </button>
                                )}
                                {wisdom?.extractedAt && (
                                    <span className="text-[10px] text-slate-500">
                                        Última extracción: {formatExtractedAt(wisdom.extractedAt)}
                                    </span>
                                )}
                            </div>
                        </>
                    ) : (
                        <p className="text-xs text-slate-500 p-4 rounded-2xl border border-dashed border-slate-200">
                            Seleccioná un objetivo del catálogo para ver su servicio SLA y la sabiduría de coberturas.
                        </p>
                    )}
                </div>
            </div>

            {scheduleSnapshot && selectedObjective && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                    <p className="text-[10px] font-black uppercase text-slate-500 flex items-center gap-1">
                        <CalendarDays size={12} />
                        Cronograma leído de Firestore — {periodLabel}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div className="rounded-xl bg-slate-50 border border-slate-200 p-2">
                            <p className="text-[10px] text-slate-500 font-bold">Celdas</p>
                            <p className="font-black text-slate-800">{scheduleSnapshot.cells}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 border border-slate-200 p-2">
                            <p className="text-[10px] text-slate-500 font-bold">Guardias</p>
                            <p className="font-black text-slate-800">{scheduleSnapshot.employees}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 border border-slate-200 p-2">
                            <p className="text-[10px] text-slate-500 font-bold">Días con turno</p>
                            <p className="font-black text-slate-800">{scheduleSnapshot.days}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 border border-slate-200 p-2">
                            <p className="text-[10px] text-slate-500 font-bold">Borrador</p>
                            <p className="font-black text-slate-800">{scheduleSnapshot.draftCount}</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {Object.entries(scheduleSnapshot.byCode)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 12)
                            .map(([code, n]) => (
                                <span
                                    key={code}
                                    className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-900"
                                >
                                    {code}: {n}
                                </span>
                            ))}
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                        Ausencias en turnos (V/L/E…): <strong>{scheduleSnapshot.absenceInTurnos}</strong>
                        {' · '}
                        Ausencias RRHH en el mes: <strong>{scheduleSnapshot.absencesRrhh}</strong>.
                        {scheduleSnapshot.absenceInTurnos === 0 && scheduleSnapshot.absencesRrhh === 0 ? (
                            <>
                                {' '}
                                Sin ausencias registradas → <strong>0 coberturas es normal</strong> (no hubo nada que cubrir).
                            </>
                        ) : (
                            <>
                                {' '}
                                Si hay ausencias pero 0 coberturas, falta el vínculo <code className="text-[10px]">coveredBy</code> o comentario &quot;Cubriendo a…&quot; en los turnos.
                            </>
                        )}
                    </p>
                </div>
            )}

            {wisdom && selectedObjective && (
                <div className="space-y-4 border-t border-indigo-100 pt-4">
                    <p className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                        {wisdom.summary}
                    </p>

                    {Object.keys(wisdom.strategyCounts).length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(wisdom.strategyCounts).map(([k, n]) => (
                                <span
                                    key={k}
                                    className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700"
                                >
                                    {COVERAGE_STRATEGY_LABELS[k as keyof typeof COVERAGE_STRATEGY_LABELS] || k}: {n}
                                </span>
                            ))}
                        </div>
                    )}

                    {suggestedCoverers.length > 0 && suggestBand && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                            <p className="text-[10px] font-black uppercase text-amber-900 mb-2">
                                Sugeridos para banda {suggestBand}
                                {suggestAbsentCode ? ` (ausencia ${suggestAbsentCode})` : ''} — según historial
                            </p>
                            <ul className="space-y-1">
                                {suggestedCoverers.map((c) => (
                                    <li key={c.empId} className="text-xs text-amber-950 flex justify-between">
                                        <span className="font-bold">{c.nombre}</span>
                                        <span>{c.byBand[suggestBand] || 0}× {suggestBand} · score {c.score}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {wisdom.coverers.length > 0 && (
                        <div>
                            <p className="text-[10px] font-black uppercase text-slate-500 mb-2 flex items-center gap-1">
                                <Users size={12} />
                                Referentes de cobertura ({wisdom.periodLabel})
                            </p>
                            <div className="overflow-x-auto rounded-2xl border border-slate-200">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-slate-500 font-black uppercase text-[10px]">
                                        <tr>
                                            <th className="text-left p-2">Guardia</th>
                                            <th className="text-center p-2">Total</th>
                                            <th className="text-center p-2">M</th>
                                            <th className="text-center p-2">T</th>
                                            <th className="text-center p-2">N</th>
                                            <th className="text-left p-2">Estrategias</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {wisdom.coverers.slice(0, 8).map((c) => (
                                            <tr key={c.empId} className="border-t border-slate-100">
                                                <td className="p-2 font-bold text-slate-800">{c.nombre}</td>
                                                <td className="p-2 text-center font-black text-indigo-700">{c.totalCoverages}</td>
                                                <td className="p-2 text-center">{c.byBand.M || '—'}</td>
                                                <td className="p-2 text-center">{c.byBand.T || '—'}</td>
                                                <td className="p-2 text-center">{c.byBand.N || '—'}</td>
                                                <td className="p-2 text-slate-600">
                                                    {Object.entries(c.byStrategy)
                                                        .map(([s, n]) => `${COVERAGE_STRATEGY_LABELS[s as keyof typeof COVERAGE_STRATEGY_LABELS]?.split(' ')[0] || s}(${n})`)
                                                        .join(' · ')}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {wisdom.events.length > 0 && (
                        <details className="rounded-2xl border border-slate-200 bg-white">
                            <summary className="cursor-pointer p-3 text-xs font-black text-slate-700">
                                Eventos detallados ({wisdom.events.length})
                            </summary>
                            <ul className="max-h-48 overflow-y-auto px-3 pb-3 space-y-1">
                                {wisdom.events.slice(0, 30).map((ev, i) => (
                                    <li key={`${ev.dateStr}-${ev.covererEmpId}-${i}`} className="text-[11px] text-slate-600">
                                        <span className="font-bold text-slate-800">{ev.dateStr}</span>
                                        {' — '}
                                        {ev.absentEmpName} ({ev.absentCode}) → {ev.covererEmpName} ({ev.covererCode})
                                        {' · '}
                                        {COVERAGE_STRATEGY_LABELS[ev.strategy]}
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}
                </div>
            )}
        </div>
    );
}
