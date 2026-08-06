import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { AUTO_LAB_CASES, type AutoLabCaseDefinition } from '@/lib/planificacion/autoLabCaseCatalog';
import {
    AUTO_LAB_BAND_OPTIONS,
    AUTO_LAB_CUSTOM_CASE_ID,
    buildCaseFromCustomDraft,
    createDefaultCustomDraft,
    loadCustomDraftPreset,
    suggestCustomEmployeeCount,
    type AutoLabAbsenceCode,
    type AutoLabCustomDraft,
    type AutoLabCustomPositionDraft,
} from '@/lib/planificacion/autoLabCustomCase';
import {
    AUTO_LAB_DAY_LETTERS,
    calculateSlaHoursForVigencia,
} from '@/lib/planificacion/autoLabServicePeriod';
import AutoLabServiceCalendar, { type AutoLabCalendarMode } from '@/components/planificacion/AutoLabServiceCalendar';
import AutoLabResolutionGrid from '@/components/planificacion/AutoLabResolutionGrid';
import AutoLabCoveragePanel from '@/components/planificacion/AutoLabCoveragePanel';
import PlanningCoverageWisdomPanel from '@/components/planificacion/PlanningCoverageWisdomPanel';
import AutoLabRealServicePanel from '@/components/planificacion/AutoLabRealServicePanel';
import AutoLabRosterSurplusPanel from '@/components/planificacion/AutoLabRosterSurplusPanel';
import { AUTO_LAB_REAL_CASE_ID, type AutoLabRealServiceBundle } from '@/lib/planificacion/autoLabRealService';
import AutoLabPositionDiagram from '@/components/planificacion/AutoLabPositionDiagram';
import { generateAutoLabSchedule, verifyAutoLabCoverage } from '@/lib/planificacion/autoLabSchedule';
import { AUTO_LAB_STACK_VERSION, AUTO_LAB_STACK_VERSION_LABEL } from '@/lib/planificacion/autoLabStackVersion';
import {
    buildAutoLabExportJson,
    buildSyntheticEmployees,
    estimateSlaVendidas,
    buildDaysInMonth,
    runAutoLabCase,
    type AutoLabRunResult,
} from '@/lib/planificacion/autoLabRuntime';
import {
    AlertTriangle,
    ArrowLeft,
    Brain,
    CalendarDays,
    CheckCircle2,
    Copy,
    FlaskConical,
    Layers,
    Plus,
    RotateCw,
    SlidersHorizontal,
    Target,
    Trash2,
    Users,
    XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { canAccessAutoLab } from '@/lib/planificacion/autoLabAccess';
import { buildObjectiveScheduleProfile, buildObjectiveServiceAnalysis, formatObjectiveCycleBlocksSummary } from '@/lib/planificacion/objectiveServiceModel';
import ObjectiveServiceAnalysisCard from '@/components/planificacion/ObjectiveServiceAnalysisCard';

const IS_EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';

const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const CYCLE_OPTIONS = ['6+2', '6+1', '5+1', '4+2'] as const;

function rotationLabel(
    mode: AutoLabCaseDefinition['rotationMode'],
    positions?: AutoLabCaseDefinition['positions'],
): string {
    if (positions && positions.length > 0) {
        const profile = buildObjectiveScheduleProfile(positions);
        if (profile.kind === 'custom_only') {
            return profile.cronogramTypeLabel;
        }
        if (profile.kind === 'mixed') {
            return profile.cronogramTypeLabel;
        }
        if (profile.kind === '24hs_only') {
            if (mode === 'fixed') return 'Puro 24 HS — bandas fijas';
            if (mode === 'rotative') return 'Puro 24 HS — rotativo M→T→N';
            return profile.cronogramTypeLabel;
        }
    }
    if (mode === 'fixed') return 'Banda fija';
    if (mode === 'rotative') return 'Rotativo M→T→N (solo puestos 24 h)';
    return 'Auto (cerebro decide)';
}

function PositionDiagram({
    positions,
    year,
    month,
    serviceStart,
    serviceEnd,
    excludedDates,
}: {
    positions: AutoLabCaseDefinition['positions'];
    year: number;
    month: number;
    serviceStart?: string;
    serviceEnd?: string;
    excludedDates?: string[];
}) {
    const slaContext = serviceStart && serviceEnd
        ? { year, month, serviceStart, serviceEnd, excludedDates }
        : undefined;
    return <AutoLabPositionDiagram positions={positions} slaContext={slaContext} />;
}

function FeasibilityBadge({ ok }: { ok: boolean }) {
    if (ok) {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-1 text-xs font-black uppercase">
                <CheckCircle2 size={14} />
                Viable
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 text-red-800 border border-red-200 px-3 py-1 text-xs font-black uppercase">
            <XCircle size={14} />
            No viable
        </span>
    );
}

function CustomServiceEditor({
    draft,
    onChange,
    estimatedSla,
    simulationYear,
    simulationMonth,
    excludedScope,
    onExcludedScopeChange,
}: {
    draft: AutoLabCustomDraft;
    onChange: (next: AutoLabCustomDraft) => void;
    estimatedSla: number;
    simulationYear: number;
    simulationMonth: number;
    excludedScope: 'ALL' | string;
    onExcludedScopeChange: (scope: 'ALL' | string) => void;
}) {
    const suggestedPax = suggestCustomEmployeeCount(draft);
    const [calendarMode, setCalendarMode] = useState<AutoLabCalendarMode>('exclude');
    const [absenceEmpId, setAbsenceEmpId] = useState('lab-emp-01');
    const [absenceCode, setAbsenceCode] = useState<AutoLabAbsenceCode>('E');

    const draftEmployees = useMemo(() => {
        const n = draft.autoEmployeeCount ? suggestedPax : draft.employeeCount;
        return buildSyntheticEmployees(n).map((e) => ({ id: e.id, nombre: e.nombre }));
    }, [draft.autoEmployeeCount, draft.employeeCount, suggestedPax]);

    useEffect(() => {
        if (!draftEmployees.some((e) => e.id === absenceEmpId) && draftEmployees[0]) {
            setAbsenceEmpId(draftEmployees[0].id);
        }
    }, [draftEmployees, absenceEmpId]);

    const updatePosition = (id: string, patch: Partial<AutoLabCustomPositionDraft>) => {
        onChange({
            ...draft,
            positions: draft.positions.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        });
    };

    const toggleBand = (pos: AutoLabCustomPositionDraft, band: (typeof AUTO_LAB_BAND_OPTIONS)[number]) => {
        const has = pos.bands.includes(band);
        const bands = has ? pos.bands.filter((b) => b !== band) : [...pos.bands, band];
        updatePosition(pos.id, { bands });
    };

    const toggleActiveDay = (pos: AutoLabCustomPositionDraft, letter: (typeof AUTO_LAB_DAY_LETTERS)[number]) => {
        const has = pos.activeDayLetters.includes(letter);
        if (has && pos.activeDayLetters.length <= 1) {
            toast.error('Debe quedar al menos un día activo');
            return;
        }
        const activeDayLetters = has
            ? pos.activeDayLetters.filter((d) => d !== letter)
            : [...pos.activeDayLetters, letter];
        updatePosition(pos.id, { activeDayLetters });
    };

    const addPosition = () => {
        const n = draft.positions.length + 1;
        onChange({
            ...draft,
            positions: [
                ...draft.positions,
                {
                    id: `pos-${Date.now()}`,
                    positionName: `Puesto ${n}`,
                    qty: 1,
                    coverageType: '24hs',
                    bands: ['M', 'T', 'N'],
                    activeDayLetters: [...AUTO_LAB_DAY_LETTERS],
                    excludedDates: [],
                },
            ],
        });
    };

    const removePosition = (id: string) => {
        if (draft.positions.length <= 1) {
            toast.error('Debe haber al menos un puesto');
            return;
        }
        onChange({ ...draft, positions: draft.positions.filter((p) => p.id !== id) });
        if (excludedScope === id) onExcludedScopeChange('ALL');
    };

    const handleServiceStartChange = (value: string) => {
        let end = draft.serviceEndDate;
        if (value > end) end = value;
        onChange({ ...draft, serviceStartDate: value, serviceEndDate: end });
    };

    const handleServiceEndChange = (value: string) => {
        let start = draft.serviceStartDate;
        if (value < start) start = value;
        onChange({ ...draft, serviceStartDate: start, serviceEndDate: value });
    };

    const toggleExcludedDate = (dateStr: string) => {
        if (excludedScope === 'ALL') {
            const next = new Set(draft.excludedDates);
            if (next.has(dateStr)) next.delete(dateStr);
            else next.add(dateStr);
            onChange({ ...draft, excludedDates: Array.from(next).sort() });
            return;
        }
        onChange({
            ...draft,
            positions: draft.positions.map((p) => {
                if (p.id !== excludedScope) return p;
                const cur = new Set(p.excludedDates);
                if (cur.has(dateStr)) cur.delete(dateStr);
                else cur.add(dateStr);
                return { ...p, excludedDates: Array.from(cur).sort() };
            }),
        });
    };

    const clearExcludedScope = () => {
        if (excludedScope === 'ALL') {
            onChange({ ...draft, excludedDates: [] });
            return;
        }
        onChange({
            ...draft,
            positions: draft.positions.map((p) =>
                p.id === excludedScope ? { ...p, excludedDates: [] } : p,
            ),
        });
    };

    const toggleAbsence = (dateStr: string) => {
        const exists = draft.absences.some((a) => a.empId === absenceEmpId && a.dateStr === dateStr);
        if (exists) {
            onChange({
                ...draft,
                absences: draft.absences.filter((a) => !(a.empId === absenceEmpId && a.dateStr === dateStr)),
            });
            return;
        }
        onChange({
            ...draft,
            absences: [
                ...draft.absences,
                { empId: absenceEmpId, dateStr, code: absenceCode },
            ].sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.empId.localeCompare(b.empId)),
        });
    };

    const clearAbsences = () => onChange({ ...draft, absences: [] });

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-950">
                <strong>Armar servicio</strong> — vigencia, puestos con pax, días activos, exclusiones SLA y{' '}
                <strong>ausencias</strong> (calendario) para probar la autocorrección del cerebro.
                El cronograma y las coberturas se actualizan en vivo (mes simulado en la barra superior).
            </div>

            <div>
                <label className="text-[10px] font-black uppercase text-slate-500">Nombre del escenario</label>
                <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => onChange({ ...draft, title: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 bg-white"
                    placeholder="Ej. Coniferal 2 puestos"
                />
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">Inicio servicio</label>
                    <input
                        type="date"
                        value={draft.serviceStartDate}
                        onChange={(e) => handleServiceStartChange(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold bg-white"
                    />
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">Fin servicio</label>
                    <input
                        type="date"
                        value={draft.serviceEndDate}
                        onChange={(e) => handleServiceEndChange(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold bg-white"
                    />
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                <span className="text-[10px] font-black uppercase text-slate-500 w-full">Plantillas rápidas</span>
                {AUTO_LAB_CASES.map((c) => (
                    <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                            const loaded = loadCustomDraftPreset(c.id);
                            if (loaded) {
                                onChange(loaded);
                                toast.info(`Plantilla: Caso ${c.order}`);
                            }
                        }}
                        className="rounded-lg border border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 px-2 py-1 text-[10px] font-bold text-slate-700"
                    >
                        Caso {c.order}
                    </button>
                ))}
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <p className="text-xs font-black uppercase text-slate-600">Puestos</p>
                    <button
                        type="button"
                        onClick={addPosition}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 text-[10px] font-black"
                    >
                        <Plus size={12} /> Puesto
                    </button>
                </div>

                {draft.positions.map((pos) => {
                    const minRot = pos.coverageType === '24hs' ? pos.qty * 2 : pos.qty;
                    return (
                        <div key={pos.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3 shadow-sm">
                            <div className="flex items-start gap-2">
                                <input
                                    type="text"
                                    value={pos.positionName}
                                    onChange={(e) => updatePosition(pos.id, { positionName: e.target.value })}
                                    className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-bold text-slate-800 bg-white"
                                />
                                <button
                                    type="button"
                                    onClick={() => removePosition(pos.id)}
                                    className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                                    title="Quitar puesto"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-500">Pax (en paralelo)</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={20}
                                        value={pos.qty}
                                        onChange={(e) => updatePosition(pos.id, { qty: Math.max(1, Number(e.target.value) || 1) })}
                                        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 font-semibold bg-white"
                                    />
                                    <p className="text-[9px] text-indigo-600 mt-1 font-bold">Rotación mín. ≈ {minRot} guardias</p>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-500">Cobertura</label>
                                    <select
                                        value={pos.coverageType}
                                        onChange={(e) => updatePosition(pos.id, {
                                            coverageType: e.target.value as '24hs' | 'custom',
                                            bands: e.target.value === '24hs' && pos.bands.length === 0
                                                ? ['M', 'T', 'N']
                                                : pos.bands,
                                        })}
                                        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 font-semibold bg-white"
                                    >
                                        <option value="24hs">24hs</option>
                                        <option value="custom">Custom</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <p className="text-[10px] font-black uppercase text-slate-500 mb-1.5">Bandas</p>
                                <div className="flex flex-wrap gap-1">
                                    {AUTO_LAB_BAND_OPTIONS.map((band) => {
                                        const on = pos.bands.includes(band);
                                        return (
                                            <button
                                                key={band}
                                                type="button"
                                                onClick={() => toggleBand(pos, band)}
                                                className={`px-2 py-1 rounded-lg text-[10px] font-black border transition-colors ${
                                                    on
                                                        ? 'bg-indigo-600 text-white border-indigo-500'
                                                        : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'
                                                }`}
                                            >
                                                {band}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <p className="text-[10px] font-black uppercase text-slate-500 mb-1.5">Días activos</p>
                                <div className="flex flex-wrap gap-1">
                                    {AUTO_LAB_DAY_LETTERS.map((letter) => {
                                        const on = pos.activeDayLetters.includes(letter);
                                        return (
                                            <button
                                                key={letter}
                                                type="button"
                                                onClick={() => toggleActiveDay(pos, letter)}
                                                className={`w-8 h-8 rounded-lg text-[10px] font-black border transition-colors ${
                                                    on
                                                        ? 'bg-emerald-600 text-white border-emerald-500'
                                                        : 'bg-white text-slate-400 border-slate-200'
                                                }`}
                                            >
                                                {letter}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {pos.excludedDates.length > 0 && (
                                <p className="text-[9px] text-rose-600 font-bold">
                                    {pos.excludedDates.length} día(s) excluido(s) solo para este puesto
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="col-span-2">
                    <label className="flex items-center gap-2 cursor-pointer text-slate-700 font-semibold">
                        <input
                            type="checkbox"
                            checked={draft.autoEmployeeCount}
                            onChange={(e) => onChange({ ...draft, autoEmployeeCount: e.target.checked })}
                            className="rounded border-slate-300"
                        />
                        Dotación automática (suma rotación mín. por puesto ≈ {suggestedPax})
                    </label>
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">Dotación total</label>
                    <input
                        type="number"
                        min={1}
                        max={64}
                        disabled={draft.autoEmployeeCount}
                        value={draft.autoEmployeeCount ? suggestedPax : draft.employeeCount}
                        onChange={(e) => onChange({ ...draft, employeeCount: Math.max(1, Number(e.target.value) || 1) })}
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-bold bg-white disabled:bg-slate-100 disabled:text-slate-500"
                    />
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">Ciclo CCT</label>
                    <select
                        value={draft.cycle}
                        onChange={(e) => onChange({ ...draft, cycle: e.target.value })}
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-bold bg-white"
                    >
                        {CYCLE_OPTIONS.map((c) => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">Rotación</label>
                    <select
                        value={draft.rotationMode}
                        onChange={(e) => onChange({
                            ...draft,
                            rotationMode: e.target.value as AutoLabCustomDraft['rotationMode'],
                        })}
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-bold bg-white"
                    >
                        <option value="rotative">Rotativo M→T→N</option>
                        <option value="fixed">Banda fija</option>
                        <option value="auto">Auto (cerebro)</option>
                    </select>
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase text-slate-500">SLA hs mes sim. (vacío = auto)</label>
                    <input
                        type="number"
                        min={0}
                        value={draft.slaVendidasOverride ?? ''}
                        onChange={(e) => {
                            const v = e.target.value;
                            onChange({
                                ...draft,
                                slaVendidasOverride: v === '' ? null : Math.max(0, Number(v) || 0),
                            });
                        }}
                        placeholder={String(estimatedSla)}
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-bold bg-white"
                    />
                </div>
            </div>

            <AutoLabServiceCalendar
                serviceStartDate={draft.serviceStartDate}
                serviceEndDate={draft.serviceEndDate}
                excludedDates={draft.excludedDates}
                positions={draft.positions}
                excludedScope={excludedScope}
                onExcludedScopeChange={onExcludedScopeChange}
                onToggleExcluded={toggleExcludedDate}
                onClearScope={clearExcludedScope}
                simulationYear={simulationYear}
                simulationMonth={simulationMonth}
                calendarMode={calendarMode}
                onCalendarModeChange={setCalendarMode}
                absenceEmpId={absenceEmpId}
                onAbsenceEmpIdChange={setAbsenceEmpId}
                absenceCode={absenceCode}
                onAbsenceCodeChange={setAbsenceCode}
                absences={draft.absences}
                employees={draftEmployees}
                onToggleAbsence={toggleAbsence}
                onClearAbsences={clearAbsences}
            />
        </div>
    );
}

export default function AutoLabPage() {
    const { isSuperAdmin, canReadModule, rolePermissions } = useAuth();
    const now = new Date();
    const [selectedId, setSelectedId] = useState(AUTO_LAB_CASES[0]?.id ?? '');
    const [customDraft, setCustomDraft] = useState<AutoLabCustomDraft>(createDefaultCustomDraft);
    const [excludedScope, setExcludedScope] = useState<'ALL' | string>('ALL');
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [realBundle, setRealBundle] = useState<AutoLabRealServiceBundle | null>(null);
    const [realLoading, setRealLoading] = useState(false);

    const canPlan = canReadModule('PLANNING');
    const canAccess = canAccessAutoLab(isSuperAdmin, rolePermissions);
    const isCustomMode = selectedId === AUTO_LAB_CUSTOM_CASE_ID;
    const isRealMode = selectedId === AUTO_LAB_REAL_CASE_ID;

    const activeCase = useMemo((): AutoLabCaseDefinition | null => {
        if (isRealMode) return realBundle?.caseDef ?? null;
        if (isCustomMode) return buildCaseFromCustomDraft(customDraft);
        return AUTO_LAB_CASES.find((c) => c.id === selectedId) ?? AUTO_LAB_CASES[0] ?? null;
    }, [isRealMode, realBundle, isCustomMode, customDraft, selectedId]);

    const estimatedCustomSla = useMemo(() => {
        if (!isCustomMode) return 0;
        const built = buildCaseFromCustomDraft(customDraft);
        if (built.serviceStartDate && built.serviceEndDate) {
            return calculateSlaHoursForVigencia(
                built.positions,
                built.serviceStartDate,
                built.serviceEndDate,
                built.excludedDates,
                year,
                month,
            );
        }
        const days = buildDaysInMonth(year, month);
        return estimateSlaVendidas(built.positions, days);
    }, [isCustomMode, customDraft, year, month]);

    const { runResult, runError } = useMemo((): { runResult: AutoLabRunResult | null; runError: string | null } => {
        if (!activeCase) return { runResult: null, runError: null };
        try {
            const result = runAutoLabCase(activeCase, year, month, isRealMode && realBundle
                ? {
                    employees: realBundle.employees,
                    objectiveIdForBrain: realBundle.objectiveId,
                }
                : undefined);
            return { runResult: result, runError: null };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[Auto Lab] runAutoLabCase', err);
            return { runResult: null, runError: msg };
        }
    }, [activeCase, year, month, isRealMode, realBundle]);

    const scheduleOutcome = useMemo(() => {
        if (!runResult || !activeCase) return null;
        return generateAutoLabSchedule(activeCase, runResult);
    }, [runResult, activeCase]);

    const coverageReport = useMemo(() => {
        if (!runResult || !activeCase || !scheduleOutcome) return null;
        return verifyAutoLabCoverage(activeCase, runResult, scheduleOutcome);
    }, [runResult, activeCase, scheduleOutcome]);

    const handleCopyJson = async () => {
        if (!runResult || !activeCase) return;
        const payload = buildAutoLabExportJson(runResult, activeCase, scheduleOutcome);
        try {
            await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
            toast.success('JSON copiado — pegalo en el chat');
        } catch {
            toast.error('No se pudo copiar al portapapeles');
        }
    };

    if (!canPlan) {
        return (
            <DashboardLayout>
                <div className="max-w-lg mx-auto mt-16 p-8 rounded-3xl bg-white shadow-lg border border-slate-200 text-center">
                    <XCircle className="mx-auto text-red-500 mb-3" size={40} />
                    <h1 className="text-lg font-black text-slate-800">Sin permiso PLANNING</h1>
                    <p className="text-sm text-slate-600 mt-2">
                        Necesitás lectura del módulo Planificación para usar Auto Lab.
                    </p>
                </div>
            </DashboardLayout>
        );
    }

    if (!canAccess) {
        return (
            <DashboardLayout>
                <div className="max-w-lg mx-auto mt-16 p-8 rounded-3xl bg-white shadow-lg border border-slate-200 text-center">
                    <FlaskConical className="mx-auto text-amber-500 mb-3" size={40} />
                    <h1 className="text-lg font-black text-slate-800">Sin permiso Auto Lab</h1>
                    <p className="text-sm text-slate-600 mt-2">
                        Necesitás el permiso <strong>Auto Lab</strong> en el rol de Planificación, o ingresar como SuperAdmin.
                    </p>
                    <Link
                        href="/admin/planificacion"
                        className="inline-flex items-center gap-2 mt-6 text-sm font-bold text-indigo-600 hover:text-indigo-800"
                    >
                        <ArrowLeft size={16} />
                        Volver a Planificación
                    </Link>
                </div>
            </DashboardLayout>
        );
    }

    const brain = runResult?.brain;
    const staffing = brain?.staffing;
    const feasibility = brain?.feasibility;

    return (
        <DashboardLayout>
            <Head>
                <title>Auto Lab — Casos de planificación | CronoApp</title>
            </Head>

            <div className="max-w-[1500px] mx-auto space-y-6">
                <div className="rounded-3xl bg-gradient-to-br from-indigo-600 to-indigo-800 text-white p-6 shadow-lg">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                            <div className="p-3 rounded-2xl bg-white/15">
                                <FlaskConical size={32} />
                            </div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-200">
                                    Laboratorio didáctico · datos sintéticos
                                </p>
                                <h1 className="text-2xl font-black tracking-tight flex items-center gap-2 flex-wrap">
                                    Auto Lab
                                    <span
                                        className="text-[10px] font-black uppercase tracking-wider bg-white/20 text-indigo-50 px-2 py-0.5 rounded-lg"
                                        title={AUTO_LAB_STACK_VERSION_LABEL || `Stack v${AUTO_LAB_STACK_VERSION}`}
                                    >
                                        v{AUTO_LAB_STACK_VERSION}
                                    </span>
                                </h1>
                                <p className="text-sm text-indigo-100 mt-1 max-w-2xl">
                                    Casos sintéticos, <strong>servicios reales</strong> de la plataforma, o armá tu propio servicio.
                                    El motor resuelve en memoria — no escribe en Firestore.
                                </p>
                            </div>
                        </div>
                        <Link
                            href="/admin/planificacion"
                            className="inline-flex items-center gap-2 rounded-xl bg-white/15 hover:bg-white/25 px-4 py-2 text-sm font-bold transition-colors"
                        >
                            <ArrowLeft size={16} />
                            Planificación
                        </Link>
                    </div>
                    {IS_EMULATOR && (
                        <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold bg-amber-400 text-amber-950 px-3 py-1 rounded-full">
                            <FlaskConical size={14} />
                            Modo emulador activo
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white border border-slate-200 shadow-sm p-4">
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wide flex items-center gap-1">
                        <CalendarDays size={14} />
                        Mes simulado
                    </label>
                    <select
                        value={month}
                        onChange={(e) => setMonth(Number(e.target.value))}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 bg-slate-50"
                    >
                        {MONTH_NAMES.map((name, idx) => (
                            <option key={name} value={idx + 1}>{name}</option>
                        ))}
                    </select>
                    <input
                        type="number"
                        value={year}
                        onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())}
                        className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 bg-slate-50"
                        min={2020}
                        max={2035}
                    />
                    {isCustomMode && runResult && (
                        <span className="text-xs text-slate-500">
                            {runResult.daysInMonth.length} día(s) activos en vigencia
                            {runResult.fullMonthDays.length !== runResult.daysInMonth.length && (
                                <> (de {runResult.fullMonthDays.length} del mes)</>
                            )}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={handleCopyJson}
                        disabled={!runResult}
                        className="ml-auto inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 text-sm font-bold shadow-sm transition-colors"
                    >
                        <Copy size={16} />
                        Copiar JSON
                    </button>
                </div>

                <div className="grid lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-3 space-y-3">
                        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                                <p className="text-xs font-black uppercase tracking-wide text-slate-600">Casos</p>
                            </div>
                            <div className="p-2 space-y-1">
                                {AUTO_LAB_CASES.map((c) => {
                                    const active = !isCustomMode && !isRealMode && c.id === activeCase?.id;
                                    return (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => setSelectedId(c.id)}
                                            className={`w-full text-left rounded-xl px-3 py-3 transition-colors ${
                                                active
                                                    ? 'bg-indigo-50 border border-indigo-200 shadow-sm'
                                                    : 'hover:bg-slate-50 border border-transparent'
                                            }`}
                                        >
                                            <p className="text-[10px] font-black text-indigo-600 uppercase">
                                                Caso {c.order}
                                            </p>
                                            <p className="text-sm font-bold text-slate-800 leading-tight mt-0.5">
                                                {c.title}
                                            </p>
                                            <p className="text-[11px] text-slate-500 mt-1">{c.subtitle}</p>
                                        </button>
                                    );
                                })}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedId(AUTO_LAB_REAL_CASE_ID);
                                        setRealBundle(null);
                                    }}
                                    className={`w-full text-left rounded-xl px-3 py-3 transition-colors border ${
                                        isRealMode
                                            ? 'bg-emerald-50 border-emerald-400 shadow-sm'
                                            : 'hover:bg-emerald-50/50 border-dashed border-emerald-300'
                                    }`}
                                >
                                    <p className="text-[10px] font-black text-emerald-800 uppercase flex items-center gap-1">
                                        <Target size={12} />
                                        Servicio real
                                    </p>
                                    <p className="text-sm font-bold text-slate-800 leading-tight mt-0.5">
                                        Objetivo de la plataforma
                                    </p>
                                    <p className="text-[11px] text-slate-500 mt-1">SLA + dotación + motor completo</p>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSelectedId(AUTO_LAB_CUSTOM_CASE_ID)}
                                    className={`w-full text-left rounded-xl px-3 py-3 transition-colors border ${
                                        isCustomMode
                                            ? 'bg-emerald-50 border-emerald-300 shadow-sm'
                                            : 'hover:bg-emerald-50/50 border-dashed border-emerald-300'
                                    }`}
                                >
                                    <p className="text-[10px] font-black text-emerald-700 uppercase flex items-center gap-1">
                                        <SlidersHorizontal size={12} />
                                        Armar servicio
                                    </p>
                                    <p className="text-sm font-bold text-slate-800 leading-tight mt-0.5">
                                        Custom — tus puestos y bandas
                                    </p>
                                    <p className="text-[11px] text-slate-500 mt-1">Editor sintético · sin Firestore</p>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-5 space-y-4">
                        {isRealMode ? (
                            <div className="rounded-2xl bg-white border border-emerald-200 shadow-sm p-5">
                                <AutoLabRealServicePanel
                                    year={year}
                                    month={month}
                                    bundle={realBundle}
                                    loading={realLoading}
                                    onBundleChange={setRealBundle}
                                    onLoadingChange={setRealLoading}
                                />
                                {activeCase && (
                                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs border-t border-slate-100 pt-4">
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">Ciclo</p>
                                            <p className="font-bold text-slate-800 mt-1">{activeCase.cycle}</p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">Rotación</p>
                                            <p className="font-bold text-slate-800 mt-1">{rotationLabel(activeCase.rotationMode, activeCase.positions)}</p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">Dotación</p>
                                            <p className="font-bold text-slate-800 mt-1">{activeCase.employeeCount} guardias reales</p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">SLA (hs)</p>
                                            <p className="font-bold text-slate-800 mt-1">{runResult?.slaVendidas ?? '—'}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : activeCase ? (
                            <>
                                <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
                                    {isCustomMode ? (
                                        <CustomServiceEditor
                                            draft={customDraft}
                                            onChange={setCustomDraft}
                                            estimatedSla={estimatedCustomSla}
                                            simulationYear={year}
                                            simulationMonth={month}
                                            excludedScope={excludedScope}
                                            onExcludedScopeChange={setExcludedScope}
                                        />
                                    ) : (
                                        <>
                                            <div className="flex items-start gap-3 mb-4">
                                                <div className="rounded-xl bg-indigo-100 p-2">
                                                    <Layers size={18} className="text-indigo-700" />
                                                </div>
                                                <div>
                                                    <h2 className="font-black text-slate-800">{activeCase.title}</h2>
                                                    <p className="text-sm text-slate-600 mt-1">{activeCase.description}</p>
                                                </div>
                                            </div>
                                            <PositionDiagram
                                                positions={activeCase.positions}
                                                year={year}
                                                month={month}
                                                serviceStart={activeCase.serviceStartDate}
                                                serviceEnd={activeCase.serviceEndDate}
                                                excludedDates={activeCase.excludedDates}
                                            />
                                        </>
                                    )}

                                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">Ciclo</p>
                                            <p className="font-bold text-slate-800 mt-1">{activeCase.cycle}</p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">Rotación</p>
                                            <p className="font-bold text-slate-800 mt-1 flex items-center gap-1">
                                                <RotateCw size={12} className="text-indigo-600" />
                                                {rotationLabel(activeCase.rotationMode, activeCase.positions)}
                                            </p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">Dotación</p>
                                            <p className="font-bold text-slate-800 mt-1 flex items-center gap-1">
                                                <Users size={12} className="text-emerald-600" />
                                                {activeCase.employeeCount} guardias sintéticos
                                            </p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">SLA (hs)</p>
                                            <p className="font-bold text-slate-800 mt-1">
                                                {runResult?.slaVendidas ?? '—'}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {!isCustomMode && (
                                    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5 space-y-3">
                                        <p className="text-xs font-black uppercase text-slate-600">Qué esperar</p>
                                        <ul className="space-y-2">
                                            {activeCase.expectations.map((exp) => (
                                                <li key={exp} className="text-sm text-slate-700 flex gap-2">
                                                    <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                                                    {exp}
                                                </li>
                                            ))}
                                        </ul>
                                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                                            <strong>Cobertura:</strong> {activeCase.coverageNotes}
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : null}

                        {isCustomMode && activeCase && activeCase.positions.length > 0 && (
                            <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
                                <p className="text-xs font-black uppercase text-slate-600 mb-3">Vista previa SLA</p>
                                <PositionDiagram
                                    positions={activeCase.positions}
                                    year={year}
                                    month={month}
                                    serviceStart={activeCase.serviceStartDate}
                                    serviceEnd={activeCase.serviceEndDate}
                                    excludedDates={activeCase.excludedDates}
                                />
                            </div>
                        )}
                    </div>

                    <div className="lg:col-span-4 space-y-4">
                        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-indigo-50 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <Brain size={18} className="text-indigo-700" />
                                    <h2 className="font-black text-slate-800 text-sm uppercase tracking-wide">
                                        Resultado cerebro
                                    </h2>
                                </div>
                                {feasibility && <FeasibilityBadge ok={feasibility.ok} />}
                            </div>

                            {brain && staffing && feasibility ? (
                                <div className="p-5 space-y-4">
                                    <ObjectiveServiceAnalysisCard
                                        analysis={
                                            brain.serviceAnalysis
                                            ?? buildObjectiveServiceAnalysis(
                                                runResult?.positions ?? activeCase.positions,
                                                brain.pickedCycle,
                                            )
                                        }
                                    />
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        {(() => {
                                            const sa = brain.serviceAnalysis
                                                ?? buildObjectiveServiceAnalysis(
                                                    runResult?.positions ?? activeCase.positions,
                                                    brain.pickedCycle,
                                                );
                                            if (sa.kind === 'mixed') {
                                                return (
                                                    <div className="col-span-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                                                        <p className="font-black uppercase text-amber-800 text-[10px]">
                                                            Ciclos (servicio mixto)
                                                        </p>
                                                        <p className="font-bold text-violet-900 text-sm mt-1">
                                                            24 HS (M/T/N):{' '}
                                                            <span className="font-black">{brain.pickedCycle}</span>
                                                        </p>
                                                        <p className="font-bold text-cyan-900 text-sm">
                                                            Custom:{' '}
                                                            <span className="font-black">{sa.cycleBlocks.custom}</span>
                                                        </p>
                                                    </div>
                                                );
                                            }
                                            return (
                                                <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
                                                    <p className="font-black uppercase text-indigo-700 text-[10px]">Ciclo elegido</p>
                                                    <p className="font-black text-indigo-900 text-lg mt-1">{brain.pickedCycle}</p>
                                                </div>
                                            );
                                        })()}
                                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                                            <p className="font-black uppercase text-emerald-700 text-[10px]">Plantilla</p>
                                            <p className="font-black text-emerald-900 text-lg mt-1">{staffing.plantillaTotal}</p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">Servicio/día (8h)</p>
                                            <p className="font-bold text-slate-800 mt-1">{staffing.servicioDiarioModo8}</p>
                                        </div>
                                        <div className="col-span-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-1">
                                            <p className="font-black uppercase text-emerald-800 text-[10px]">Francos</p>
                                            {brain.serviceAnalysis?.francoBudget ? (
                                                <>
                                                    <p className="text-[11px] font-bold text-violet-900">
                                                        Rotación 24 HS:{' '}
                                                        {brain.serviceAnalysis.francoBudget.rotation24hs.francosSimultaneosRotacion}{' '}
                                                        F simultáneo(s) (1 por pax)
                                                    </p>
                                                    <p className="text-[11px] font-bold text-slate-800">
                                                        Día pico: pool {brain.serviceAnalysis.francoBudget.poolFrancosDiaPico}{' '}
                                                        <span className="font-normal text-slate-500">
                                                            ({staffing.plantillaTotal} − {staffing.servicioDiarioModo8} servicio)
                                                        </span>
                                                    </p>
                                                </>
                                            ) : (
                                                <p className="font-bold text-slate-800 mt-1">{staffing.poolFrancos}</p>
                                            )}
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">Rotación M→T→N</p>
                                            <p className="font-bold text-slate-800 mt-1">{brain.rotateShifts ? 'ON' : 'OFF'}</p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">Pico servicio</p>
                                            <p className="font-bold text-slate-800 mt-1">{staffing.picoEnServicio}</p>
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                                        <p>
                                            <span className="font-bold text-slate-700">Oferta equipo:</span>{' '}
                                            {feasibility.metrics.peopleAvailable} guardias ·{' '}
                                            {Math.round(feasibility.metrics.offerHours)} h
                                        </p>
                                        <p>
                                            <span className="font-bold text-slate-700">Demanda estructural:</span>{' '}
                                            {Math.round(feasibility.metrics.structuralDemandHours)} h · SLA{' '}
                                            {runResult?.slaVendidas} h
                                        </p>
                                        <p>
                                            <span className="font-bold text-slate-700">Plantilla por puestos:</span>{' '}
                                            {feasibility.metrics.peopleNeededForTarget} guardias
                                            {feasibility.metrics.peopleNeededByHoursEstimate != null
                                                && feasibility.metrics.peopleNeededByHoursEstimate
                                                    > feasibility.metrics.peopleNeededForTarget && (
                                                <span className="text-slate-500">
                                                    {' '}
                                                    (SLA horas sugiere ~{feasibility.metrics.peopleNeededByHoursEstimate}, no aplica)
                                                </span>
                                            )}
                                        </p>
                                    </div>

                                    {brain.modo12DaysAuto.length > 0 && (
                                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                                            <strong>Modo 12 auto:</strong> {brain.modo12DaysAuto.join(', ')}
                                        </div>
                                    )}

                                    {runResult && runResult.paddedEmployees.length > 0 && (
                                        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-950">
                                            <p className="font-black uppercase text-indigo-800 mb-2 flex items-center gap-1">
                                                <Users size={12} />
                                                Dotación completada automáticamente
                                            </p>
                                            <p className="mb-2">
                                                {runResult.sourceEmployees.length} guardia(s) reales →{' '}
                                                {runResult.employees.length} para planificar (+{runResult.paddedEmployees.length} sintético(s)).
                                            </p>
                                            <ul className="space-y-0.5 font-mono text-[11px]">
                                                {runResult.paddedEmployees.map((e) => (
                                                    <li key={e.id}>{e.nombre}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {runResult?.rosterSurplus?.hasSurplus && !scheduleOutcome && (
                                        <AutoLabRosterSurplusPanel surplus={runResult.rosterSurplus} />
                                    )}

                                    {runResult?.rosterWarnings.map((w) => (
                                        <div
                                            key={w}
                                            className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-950"
                                        >
                                            {w}
                                        </div>
                                    ))}

                                    {feasibility.reasons.length > 0 && (
                                        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                                            <p className="text-xs font-black uppercase text-red-800 mb-2">Bloqueos</p>
                                            <ul className="space-y-1">
                                                {feasibility.reasons.map((r) => (
                                                    <li key={r} className="text-xs text-red-900 flex gap-2">
                                                        <XCircle size={12} className="shrink-0 mt-0.5" />
                                                        {r}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {(brain.warnings.length > 0 || feasibility.warnings.length > 0) && (
                                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                                            <p className="text-xs font-black uppercase text-amber-800 mb-2 flex items-center gap-1">
                                                <AlertTriangle size={12} />
                                                Avisos
                                            </p>
                                            <ul className="space-y-1">
                                                {[...brain.warnings, ...feasibility.warnings].map((w) => (
                                                    <li key={w} className="text-xs text-amber-950">{w}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {brain.diagnosis && (
                                        <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-700">
                                            <p className="font-black uppercase text-slate-500 text-[10px] mb-1">Diagnóstico</p>
                                            <p className="text-indigo-800 font-semibold">{brain.diagnosis.balanceLabel}</p>
                                            <p className="mt-1">{brain.diagnosis.resolution}</p>
                                        </div>
                                    )}

                                    {brain.capacityRulesSummary && (
                                        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-950">
                                            <p className="font-black uppercase text-violet-800 text-[10px] mb-1">
                                                Capacidad guardias (cobertura)
                                            </p>
                                            <p>{brain.capacityRulesSummary}</p>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="p-8 text-center text-sm text-slate-500 space-y-2">
                                    <p>No se pudo calcular el cerebro para este caso.</p>
                                    {runError && (
                                        <p className="text-xs text-red-800 font-mono bg-red-50 border border-red-200 rounded-lg p-2">
                                            {runError}
                                        </p>
                                    )}
                                    {isRealMode && !realBundle && (
                                        <p className="text-xs text-amber-800">
                                            Elegí objetivo y empresa en el panel «Servicio real» y esperá a que cargue el SLA.
                                        </p>
                                    )}
                                    <p className="text-[10px] text-slate-400">
                                        Abrí la consola del navegador (F12) si el caso ya está cargado — suele ser un error de runtime en el motor.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {runResult && scheduleOutcome && (
                    <div className="space-y-4">
                        {scheduleOutcome.rosterSurplus?.hasSurplus && (
                            <AutoLabRosterSurplusPanel
                                surplus={scheduleOutcome.rosterSurplus}
                                afterSchedule
                            />
                        )}
                        <AutoLabResolutionGrid
                            runResult={runResult}
                            scheduleOutcome={scheduleOutcome}
                        />
                        {scheduleOutcome.cronogramValidationIssues
                            && scheduleOutcome.cronogramValidationIssues.length > 0 && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 shadow-sm p-4">
                                <p className="text-xs font-black uppercase text-amber-900 mb-2">
                                    Reglas de crono ({scheduleOutcome.cronogramValidationIssues.length})
                                </p>
                                <ul className="space-y-1 max-h-40 overflow-y-auto text-[11px] text-amber-950">
                                    {scheduleOutcome.cronogramValidationIssues.slice(0, 30).map((v, i) => (
                                        <li key={`${v.code}-${v.dateStr ?? ''}-${i}`}>
                                            [{v.severity}] {v.message}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {scheduleOutcome.capacityRisks && scheduleOutcome.capacityRisks.length > 0 && (
                            <div className="rounded-2xl border border-violet-200 bg-violet-50/80 shadow-sm p-4">
                                <p className="text-xs font-black uppercase text-violet-900 mb-2">
                                    Alertas de capacidad ({scheduleOutcome.capacityRisks.length})
                                </p>
                                <ul className="space-y-1 max-h-40 overflow-y-auto text-[11px] text-violet-950">
                                    {scheduleOutcome.capacityRisks.slice(0, 25).map((r, i) => (
                                        <li key={`${r.empId}-${r.dateStr}-${i}`}>
                                            {r.dateStr} · {r.empId.slice(0, 8)}… · {r.kind}: {r.message}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <AutoLabCoveragePanel
                            report={coverageReport}
                            employees={[
                                ...runResult.employees,
                                ...(scheduleOutcome.externalRetEmployees ?? []),
                            ]}
                            absenceCoverageGaps={scheduleOutcome.absenceCoverageGaps}
                            absenceSplitActions={scheduleOutcome.absenceSplitActions}
                            absenceCoveragePlan={scheduleOutcome.absenceCoveragePlan}
                            externalRetActions={scheduleOutcome.externalRetActions}
                            fixerLog={scheduleOutcome.fixerLog}
                            fixerSummary={scheduleOutcome.fixerSummary}
                        />
                        <PlanningCoverageWisdomPanel
                            defaultObjectiveId={realBundle?.objectiveId}
                            labYear={year}
                            labMonth={month}
                        />
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
