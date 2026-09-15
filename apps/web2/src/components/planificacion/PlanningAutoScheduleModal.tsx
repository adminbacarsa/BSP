import React from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Wand2, X, RefreshCw, Loader2, ArrowLeftRight, ChevronUp, ChevronDown } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SupervisorPinInput } from '@/components/ui';
import ObjectiveServiceAnalysisCard from '@/components/planificacion/ObjectiveServiceAnalysisCard';
import { formatDayDemandSummary } from '@/lib/planificacion/objectiveCoverageDemand';
import { getDateKey } from '@/lib/planificacion/utils';
import { resolveAutoPlanningBrain } from '@/lib/planificacion/autoPlanningBrain';
import { buildScheduleOptimizationSuggestions } from '@/lib/planificacion/scheduleOptimizationSuggestions';

export type PlanningAutoScheduleModalProps = {
    autoV2Loading: boolean;
    autoV2Generating: boolean;
    autoV2GeminiLoading: boolean;
    autoWizardStep: 'configure' | 'detecting' | 'verified' | 'sla_open' | 'done';
    autoV2CoveragePreflight: any;
    autoV2BudgetMode: 'cct' | 'calendar';
    setAutoV2BudgetMode: (value: 'cct' | 'calendar') => void;
    setAutoHelpTopic: (value: string) => void;
    autoOverwrite: boolean;
    setAutoOverwrite: React.Dispatch<React.SetStateAction<boolean>>;
    autoCoverAbsences: boolean;
    setAutoCoverAbsences: React.Dispatch<React.SetStateAction<boolean>>;
    autoRotateForce: boolean | null;
    setAutoRotateForce: React.Dispatch<React.SetStateAction<boolean | null>>;
    autoPlanningBrainReport: any;
    useSixPlusOne: boolean;
    setUseSixPlusOne: React.Dispatch<React.SetStateAction<boolean>>;
    planningDotacionEmployees: any[];
    daysInMonth: Date[];
    autoContingenciaDias: Set<string>;
    setAutoContingenciaDias: React.Dispatch<React.SetStateAction<Set<string>>>;
    autoAbsencesMap: Record<string, Map<string, string>>;
    autoAjustarCrono: boolean;
    setAutoAjustarCrono: React.Dispatch<React.SetStateAction<boolean>>;
    autoV2RunGemini: boolean;
    setAutoV2RunGemini: React.Dispatch<React.SetStateAction<boolean>>;
    autoHelpTopic: string;
    displayedEmployees: any[];
    handleUnassignEmployee: (emp: any) => Promise<unknown>;
    setAutoWizardStep: (value: 'configure' | 'detecting' | 'verified' | 'sla_open' | 'done') => void;
    employees: any[];
    selectedObjective: string;
    autoPlanningBrainInputRef: React.MutableRefObject<any>;
    autoPlanningBrainRef: React.MutableRefObject<any>;
    setAutoPlanningBrainReport: (value: any) => void;
    setAutoCycles: (value: string[]) => void;
    autoSelectedCyclesRef: React.MutableRefObject<string[]>;
    objectiveServiceAnalysis: any;
    autoV2Report: any;
    autoV2Progress: { pct: number; label: string } | null;
    autoV2GenStats: any;
    autoCycles: string[];
    slaVendidas: number;
    autoCoverageGaps: any[];
    coverageSelectedDays: Set<string>;
    setCoverageSelectedDays: React.Dispatch<React.SetStateAction<Set<string>>>;
    setPendingChanges: React.Dispatch<React.SetStateAction<Record<string, any>>>;
    setAutoCoverageGaps: React.Dispatch<React.SetStateAction<any[]>>;
    setPlanCoverageModalGaps: (value: any[]) => void;
    positionStructure: any[];
    autoV2FormReport: any;
    rebalanceAutoForm: () => void | Promise<void>;
    autoV2Rebalancing: boolean;
    autoV2RebalanceLog: any[];
    autoV2TrailDiag: any;
    autoV2ShowTrailDiag: boolean;
    setAutoV2ShowTrailDiag: React.Dispatch<React.SetStateAction<boolean>>;
    capOverflowEmps: { empId: string; nombre: string }[];
    over200AuthChecked: Record<string, boolean>;
    setOver200AuthChecked: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    over200AuthPin: string;
    setOver200AuthPin: (value: string) => void;
    over200AuthError: string;
    setOver200AuthError: (value: string) => void;
    authorizedOver200Ids: Set<string>;
    setAuthorizedOver200Ids: React.Dispatch<React.SetStateAction<Set<string>>>;
    authorizedOver200IdsRef: React.MutableRefObject<Set<string>>;
    setCapOverflowEmps: (value: { empId: string; nombre: string }[]) => void;
    applyAutoScheduleV2: (cycles?: string[]) => void | Promise<void>;
    autoWizardPersonalize: boolean;
    setAutoWizardPersonalize: React.Dispatch<React.SetStateAction<boolean>>;
    runFullGeneration: () => void;
    runAutoV2PlanningAgentGemini: (...args: any[]) => Promise<any>;
    autoV2LastRun: any;
    autoV2Coverage: any;
    pendingChanges: Record<string, any>;
    setAutoV2Coverage: (value: any) => void;
    setAutoV2LastRun: (value: any) => void;
    setAutoV2Suggestions: (value: any) => void;
    slaDebug: { id: string; data: any } | null;
    setSlaDebug: (value: { id: string; data: any } | null) => void;
    fetchSlaDebug: () => void | Promise<void>;
    slaDebugLoading: boolean;
    setAutoV2GeminiLoading: (value: boolean) => void;
    setAutoV2Progress: (value: { pct: number; label: string } | null) => void;
    autoV2GeminiSummary: string | null;
    setShowAutoV2Modal: (value: boolean) => void;
};

export function PlanningAutoScheduleModal(p: PlanningAutoScheduleModalProps) {
    const {
        autoV2Loading,
        autoV2Generating,
        autoV2GeminiLoading,
        autoWizardStep,
        autoV2CoveragePreflight,
        autoV2BudgetMode,
        setAutoV2BudgetMode,
        setAutoHelpTopic,
        autoOverwrite,
        setAutoOverwrite,
        autoCoverAbsences,
        setAutoCoverAbsences,
        autoRotateForce,
        setAutoRotateForce,
        autoPlanningBrainReport,
        useSixPlusOne,
        setUseSixPlusOne,
        planningDotacionEmployees,
        daysInMonth,
        autoContingenciaDias,
        setAutoContingenciaDias,
        autoAbsencesMap,
        autoAjustarCrono,
        setAutoAjustarCrono,
        autoV2RunGemini,
        setAutoV2RunGemini,
        autoHelpTopic,
        displayedEmployees,
        handleUnassignEmployee,
        setAutoWizardStep,
        employees,
        selectedObjective,
        autoPlanningBrainInputRef,
        autoPlanningBrainRef,
        setAutoPlanningBrainReport,
        setAutoCycles,
        autoSelectedCyclesRef,
        objectiveServiceAnalysis,
        autoV2Report,
        autoV2Progress,
        autoV2GenStats,
        autoCycles,
        slaVendidas,
        autoCoverageGaps,
        coverageSelectedDays,
        setCoverageSelectedDays,
        setPendingChanges,
        setAutoCoverageGaps,
        setPlanCoverageModalGaps,
        positionStructure,
        autoV2FormReport,
        rebalanceAutoForm,
        autoV2Rebalancing,
        autoV2RebalanceLog,
        autoV2TrailDiag,
        autoV2ShowTrailDiag,
        setAutoV2ShowTrailDiag,
        capOverflowEmps,
        over200AuthChecked,
        setOver200AuthChecked,
        over200AuthPin,
        setOver200AuthPin,
        over200AuthError,
        setOver200AuthError,
        authorizedOver200Ids,
        setAuthorizedOver200Ids,
        authorizedOver200IdsRef,
        setCapOverflowEmps,
        applyAutoScheduleV2,
        autoWizardPersonalize,
        setAutoWizardPersonalize,
        runFullGeneration,
        runAutoV2PlanningAgentGemini,
        autoV2LastRun,
        autoV2Coverage,
        pendingChanges,
        setAutoV2Coverage,
        setAutoV2LastRun,
        setAutoV2Suggestions,
        slaDebug,
        setSlaDebug,
        fetchSlaDebug,
        slaDebugLoading,
        setAutoV2GeminiLoading,
        setAutoV2Progress,
        autoV2GeminiSummary,
        setShowAutoV2Modal,
    } = p;
    if (typeof document === 'undefined') return null;
    return createPortal(
                    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { if (!autoV2Loading && !autoV2Generating) setShowAutoV2Modal(false); }}>
                        <div className="bg-white rounded-xl shadow-2xl w-[760px] max-w-[95vw] max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

                            {/* Header */}
                            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
                                <div className="flex items-center gap-2">
                                    <Wand2 size={18} className="text-amber-600 shrink-0"/>
                                    <h3 className="font-black text-base text-slate-800">Automatizar cronograma</h3>
                                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">COSP</span>
                                </div>
                                <button type="button" onClick={() => { if (!autoV2Loading && !autoV2Generating) setShowAutoV2Modal(false); }} disabled={autoV2Loading || autoV2Generating} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 transition-colors">
                                    <X size={18}/>
                                </button>
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 space-y-3">

                                {/* preflight configure — se muestra en panel derecho del layout 2 paneles */}

                                {(autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && autoV2CoveragePreflight && (
                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-wide mb-1">Objetivo pedía (SLA)</p>
                                        <p className="text-[10px] text-slate-700 font-bold">
                                            {Object.entries(autoV2CoveragePreflight.monthBandDemand).map(([c, n]) => `${n}×${c}`).join(' · ')} en el mes
                                        </p>
                                        <p className="text-[10px] text-slate-500 mt-0.5">
                                            Ej. día tipo: {formatDayDemandSummary(autoV2CoveragePreflight.dayDemands.find(d => d.totalPaxUnits > 0) || autoV2CoveragePreflight.dayDemands[0])}
                                        </p>
                                    </div>
                                )}

                                {/* Paso 1: configuración — layout 2 paneles */}
                                {autoWizardStep === 'configure' && !autoV2Loading && !autoV2Generating && (
                                    <div className="flex gap-5">

                                        {/* ── PANEL IZQUIERDO: opciones ── */}
                                        <div className="w-[248px] shrink-0 space-y-4">

                                            {/* Cómputo de horas */}
                                            <div>
                                                <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-2">Cómputo de horas</p>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('budget-cct')} onClick={() => setAutoV2BudgetMode('cct')}
                                                        className={`py-3 px-3 rounded-xl text-left border-2 transition-colors ${autoV2BudgetMode === 'cct' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:border-amber-200'}`}>
                                                        <div className={`text-[11px] font-black ${autoV2BudgetMode === 'cct' ? 'text-amber-800' : 'text-slate-600'}`}>CCT</div>
                                                        <div className={`text-[9px] font-bold mt-0.5 ${autoV2BudgetMode === 'cct' ? 'text-amber-600' : 'text-slate-400'}`}>por tramos</div>
                                                        {autoV2BudgetMode === 'cct' && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5" />}
                                                    </button>
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('budget-calendar')} onClick={() => setAutoV2BudgetMode('calendar')}
                                                        className={`py-3 px-3 rounded-xl text-left border-2 transition-colors ${autoV2BudgetMode === 'calendar' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:border-amber-200'}`}>
                                                        <div className={`text-[11px] font-black ${autoV2BudgetMode === 'calendar' ? 'text-amber-800' : 'text-slate-600'}`}>Simple</div>
                                                        <div className={`text-[9px] font-bold mt-0.5 ${autoV2BudgetMode === 'calendar' ? 'text-amber-600' : 'text-slate-400'}`}>200h netas</div>
                                                        {autoV2BudgetMode === 'calendar' && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5" />}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Ciclo de trabajo */}
                                            <div>
                                                <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-2">Ciclo de trabajo</p>
                                                <div className="px-3 py-3 rounded-xl border-2 border-indigo-400 bg-indigo-50">
                                                    <div className="text-[11px] font-black text-indigo-800">Esquema 6+2 · fijo</div>
                                                    <div className="text-[9px] font-bold mt-0.5 text-indigo-500">6 días trabajo · 2 franco · D12/N12 solo por ajustar o licencias</div>
                                                </div>
                                            </div>

                                            {/* Opciones */}
                                            <div>
                                                <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-2">Opciones</p>
                                                <div className="space-y-1.5">
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('overwrite')} onClick={() => setAutoOverwrite(p => !p)}
                                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-colors ${autoOverwrite ? 'border-slate-400 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}>
                                                        <div className={`relative w-8 h-4 rounded-full shrink-0 transition-colors ${autoOverwrite ? 'bg-slate-500' : 'bg-slate-200'}`}>
                                                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${autoOverwrite ? 'translate-x-4' : ''}`} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className={`text-[11px] font-black ${autoOverwrite ? 'text-slate-800' : 'text-slate-500'}`}>Sobreescribir celdas</div>
                                                            <div className="text-[9px] font-bold text-slate-400">reemplaza asignaciones existentes</div>
                                                        </div>
                                                    </button>
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('coverage')} onClick={() => setAutoCoverAbsences(p => !p)}
                                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-colors ${autoCoverAbsences ? 'border-teal-300 bg-teal-50' : 'border-slate-200 hover:border-teal-200'}`}>
                                                        <div className={`relative w-8 h-4 rounded-full shrink-0 transition-colors ${autoCoverAbsences ? 'bg-teal-500' : 'bg-slate-200'}`}>
                                                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${autoCoverAbsences ? 'translate-x-4' : ''}`} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className={`text-[11px] font-black ${autoCoverAbsences ? 'text-teal-800' : 'text-slate-500'}`}>Cobertura de ausencias</div>
                                                            <div className="text-[9px] font-bold text-slate-400">asigna reemplazos por V/L/E/A/PG</div>
                                                        </div>
                                                    </button>
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('rotate')} onClick={() => setAutoRotateForce(p => { const cur = p ?? autoPlanningBrainReport?.rotateShifts ?? true; return !cur; })}
                                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-colors ${(autoRotateForce ?? autoPlanningBrainReport?.rotateShifts) ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-emerald-200'}`}>
                                                        <div className={`relative w-8 h-4 rounded-full shrink-0 transition-colors ${(autoRotateForce ?? autoPlanningBrainReport?.rotateShifts) ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                                                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${(autoRotateForce ?? autoPlanningBrainReport?.rotateShifts) ? 'translate-x-4' : ''}`} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className={`text-[11px] font-black ${(autoRotateForce ?? autoPlanningBrainReport?.rotateShifts) ? 'text-emerald-800' : 'text-slate-500'}`}>Turnos rotativos M→T→N</div>
                                                            <div className="text-[9px] font-bold text-slate-400">
                                                                Auto {autoPlanningBrainReport?.rotateShifts ? 'ON' : 'OFF'}
                                                                {autoRotateForce !== null ? (autoRotateForce ? ' · forzado ON' : ' · forzado OFF') : ' · tocá para forzar'}
                                                            </div>
                                                        </div>
                                                    </button>
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('sixone')} onClick={() => setUseSixPlusOne(p => !p)}
                                                        disabled={!(planningDotacionEmployees.length % 6 === 0 && planningDotacionEmployees.length >= 6)}
                                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-colors disabled:opacity-40 ${useSixPlusOne ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-emerald-200'}`}>
                                                        <div className={`relative w-8 h-4 rounded-full shrink-0 transition-colors ${useSixPlusOne ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                                                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${useSixPlusOne ? 'translate-x-4' : ''}`} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className={`text-[11px] font-black ${useSixPlusOne ? 'text-emerald-800' : 'text-slate-500'}`}>Ciclo 6+1 · banda fija</div>
                                                            <div className="text-[9px] font-bold text-slate-400">
                                                                {planningDotacionEmployees.length % 6 === 0 && planningDotacionEmployees.length >= 6
                                                                    ? `${planningDotacionEmployees.length / 6} grupo(s) de 6 · 85.7%`
                                                                    : `múltiplo de 6 requerido (actual: ${planningDotacionEmployees.length})`}
                                                            </div>
                                                        </div>
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Contingencia */}
                                            <div onMouseEnter={() => setAutoHelpTopic('contingency')}>
                                                <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-2">Contingencia — Modo 12</p>
                                                <div className="flex flex-wrap gap-1">
                                                    {daysInMonth.map(day => {
                                                        const ds = getDateKey(day);
                                                        const sel = autoContingenciaDias.has(ds);
                                                        const isWe = day.getDay() === 0 || day.getDay() === 6;
                                                        return (
                                                            <button key={ds} type="button" title={ds}
                                                                onClick={() => { setAutoContingenciaDias(prev => { const next = new Set(prev); if (next.has(ds)) next.delete(ds); else next.add(ds); return next; }); }}
                                                                className={`min-w-[1.65rem] h-6 rounded text-[10px] font-black border transition-colors ${sel ? 'bg-violet-600 text-white border-violet-700' : isWe ? 'bg-rose-50 text-rose-600 border-rose-200 hover:border-violet-300' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}>
                                                                {day.getDate()}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                {autoContingenciaDias.size > 0 && <p className="text-[9px] font-bold text-violet-700 mt-1">{autoContingenciaDias.size} día(s) · D12+N12</p>}
                                            </div>

                                            {/* Ausencias detectadas */}
                                            {autoV2CoveragePreflight && autoV2CoveragePreflight.employees.some(e => e.blockedCount > 0) && (
                                                <div onMouseEnter={() => setAutoHelpTopic('absences')}>
                                                    <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-2">Ausencias en el mes</p>
                                                    <div className="space-y-1.5">
                                                        {autoV2CoveragePreflight.employees.filter(e => e.blockedCount > 0).map(emp => {
                                                            const absMap = autoAbsencesMap[emp.empId];
                                                            const absDates = [...emp.blockedDays].sort();
                                                            const codes = absMap
                                                                ? [...new Set([...absMap.values()].filter(c => ['V','L','E','A','PG','AA'].includes(c)))]
                                                                : [];
                                                            return (
                                                                <div key={emp.empId} className="px-2.5 py-2 rounded-xl border-2 border-amber-200 bg-amber-50">
                                                                    <div className="flex items-start justify-between gap-1.5">
                                                                        <div className="min-w-0">
                                                                            <div className="text-[10px] font-black text-amber-800 truncate">{emp.nombre}</div>
                                                                            <div className="text-[9px] font-bold text-amber-600 mt-0.5">
                                                                                {emp.blockedCount} día(s){codes.length > 0 && ` · ${codes.join('/')}`}
                                                                            </div>
                                                                        </div>
                                                                        <span className="shrink-0 text-[9px] font-black px-2 py-1 rounded-lg border border-violet-200 bg-violet-50 text-violet-600">
                                                                            D12 auto
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    {autoCoverAbsences && (
                                                        <p className="text-[9px] font-bold text-teal-700 mt-1.5">Cobertura auto activa · RET → banda del ausente</p>
                                                    )}
                                                </div>
                                            )}

                                            {/* Avanzado */}
                                            <div className="border-t border-slate-100 pt-3">
                                                <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-2">Avanzado</p>
                                                <div className="space-y-1.5">
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('intensive')}
                                                        onClick={() => (autoRotateForce ?? autoPlanningBrainReport?.rotateShifts) && setAutoAjustarCrono(p => !p)}
                                                        disabled={!(autoRotateForce ?? autoPlanningBrainReport?.rotateShifts)}
                                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-colors disabled:opacity-30 ${autoAjustarCrono ? 'border-violet-300 bg-violet-50' : 'border-slate-200 hover:border-violet-200'}`}>
                                                        <div className={`relative w-8 h-4 rounded-full shrink-0 transition-colors ${autoAjustarCrono ? 'bg-violet-500' : 'bg-slate-200'}`}>
                                                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${autoAjustarCrono ? 'translate-x-4' : ''}`} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className={`text-[11px] font-black ${autoAjustarCrono ? 'text-violet-800' : 'text-slate-500'}`}>Intensivo mes completo</div>
                                                            <div className="text-[9px] font-bold text-slate-400">4+2→6+1 · más RET</div>
                                                        </div>
                                                    </button>
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('gemini')} onClick={() => setAutoV2RunGemini(p => !p)}
                                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-colors ${autoV2RunGemini ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-indigo-200'}`}>
                                                        <div className={`relative w-8 h-4 rounded-full shrink-0 transition-colors ${autoV2RunGemini ? 'bg-indigo-500' : 'bg-slate-200'}`}>
                                                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${autoV2RunGemini ? 'translate-x-4' : ''}`} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className={`text-[11px] font-black ${autoV2RunGemini ? 'text-indigo-800' : 'text-slate-500'}`}>Ajuste fino IA (Gemini)</div>
                                                            <div className="text-[9px] font-bold text-slate-400">opcional · 30-60s extra</div>
                                                        </div>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        {/* ── PANEL DERECHO: explicación + diagnóstico ── */}
                                        <div className="flex-1 flex flex-col gap-3 min-w-0">

                                            {/* Card explicación dinámica */}
                                            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3.5 flex-1 min-h-[200px]">
                                                {autoHelpTopic === 'default' && (
                                                    <div>
                                                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-2">Cómo funciona el motor COSP</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Genera el cronograma del mes completo en base a la dotación y el SLA del objetivo.</p>
                                                        <div className="space-y-1.5 text-[10px] font-bold text-slate-600">
                                                            <div className="flex items-start gap-2"><span className="text-amber-600 shrink-0">Modo 8</span><span>M+T+N con franco rotativo. Para cada día: 3 trabajan, 1 descansa.</span></div>
                                                            <div className="flex items-start gap-2"><span className="text-amber-600 shrink-0">Modo 12</span><span>D12+N12 automático cuando hay vacaciones/licencia/enfermedad en la dotación.</span></div>
                                                            <div className="flex items-start gap-2"><span className="text-violet-600 shrink-0">Contingencia</span><span>D12+N12 manual en fechas específicas para liberar RETs.</span></div>
                                                        </div>
                                                        {autoV2CoveragePreflight && (
                                                            <div className="mt-3 pt-2.5 border-t border-slate-200">
                                                                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Demanda del objetivo</p>
                                                                <p className="text-[10px] font-bold text-slate-700">{Object.entries(autoV2CoveragePreflight.monthBandDemand).map(([c, n]) => `${n}×${c}`).join(' · ')} · <span className="text-amber-700">{slaVendidas}h vendidas</span></p>
                                                                {autoV2CoveragePreflight.totalAbsenceDays > 0 && <p className="text-[10px] font-bold text-amber-700 mt-0.5">{autoV2CoveragePreflight.totalAbsenceDays} días con ausencias/licencias</p>}
                                                            </div>
                                                        )}
                                                        <p className="mt-3 text-[9px] text-slate-400 font-bold">Pasá el cursor sobre una opción para ver su descripción.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'budget-cct' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-amber-800 mb-2">CCT por tramos</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Calcula las horas según el convenio 422/05, dividiendo el mes en dos tramos:</p>
                                                        <div className="space-y-1 text-[10px] font-bold text-slate-600 mb-3"><div><strong>T1</strong> · días 1–24: horas normales hasta el tope del tramo.</div><div><strong>T2</strong> · días 25–fin: cola acumulada del mes.</div></div>
                                                        <p className="text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-2">✓ Recomendado para la mayoría de objetivos con guardias bajo CCT 422/05.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'budget-calendar' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-amber-800 mb-2">Calendario simple</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Cuenta las horas de corrido sin dividir el mes en tramos. Límite único: <strong>200h netas</strong> por mes.</p>
                                                        <p className="text-[10px] font-bold text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">Más flexible, pero puede no respetar exactamente el CCT. Usalo cuando el objetivo tiene acuerdo particular o no está bajo convenio.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'scheme-fixed' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-indigo-800 mb-2">Esquema 6+2 · fijo</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Todos los empleados trabajan <strong>6 días seguidos y descansan 2</strong>. Ciclo idéntico para toda la dotación.</p>
                                                        <div className="text-[10px] font-mono font-bold text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2 mb-3">LLLLLLFF · LLLLLLFF · LLLLLLFF…</div>
                                                        <p className="text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-2">✓ Más fácil de supervisar y auditar. <strong>Recomendado</strong> para la mayoría de objetivos.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'scheme-auto' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-amber-800 mb-2">Esquema automático</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">El cerebro elige el ciclo más eficiente: puede usar <strong>6+2, 6+1 o 4+2</strong> para distintos empleados según la dotación.</p>
                                                        <p className="text-[10px] font-bold text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">⚠ Puede mezclar ciclos — la grilla se vuelve más difícil de leer. Usalo solo para experimentar con dotaciones no estándar.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'overwrite' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-slate-800 mb-2">Sobreescribir celdas</p>
                                                        <div className="space-y-2 text-[10px] font-bold">
                                                            <div className="rounded-lg bg-slate-100 px-2.5 py-2 text-slate-700"><strong>OFF</strong> (recomendado) — solo rellena celdas vacías. Las asignaciones manuales que ya hiciste se preservan.</div>
                                                            <div className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-amber-800"><strong>ON</strong> — el motor reemplaza todo, incluso lo que editaste a mano. Útil si querés empezar desde cero.</div>
                                                        </div>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'coverage' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-teal-800 mb-2">Cobertura de ausencias</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Cuando está activo, tras generar el crono el motor asigna reemplazos para V, L, E, A y PG pre-declaradas.</p>
                                                        <div className="space-y-1.5 text-[10px] font-bold text-slate-600 mb-3">
                                                            <div className="flex items-start gap-2"><span className="text-teal-600 shrink-0 font-black">1.</span><span><strong>Sin turno</strong> — empleado libre ese día (F o sin asignación).</span></div>
                                                            <div className="flex items-start gap-2"><span className="text-teal-600 shrink-0 font-black">2.</span><span><strong>RET</strong> — vigilador en stand-by, se convierte al turno que cubre.</span></div>
                                                            <div className="flex items-start gap-2"><span className="text-amber-600 shrink-0 font-black">3.</span><span><strong>FT requerido</strong> — sin candidato: se avisa en toast. El operador lo resuelve manualmente.</span></div>
                                                        </div>
                                                        <p className="text-[10px] font-bold text-teal-700 bg-teal-50 rounded-lg px-2.5 py-2">Solo actúa en el motor 6+2 bandas fijas. ESC y ext.12hs se gestionan desde Operaciones.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'rotate' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-emerald-800 mb-2">Turnos rotativos M→T→N</p>
                                                        <div className="space-y-2 text-[10px] font-bold mb-2">
                                                            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-2 text-emerald-800"><strong>ON</strong> — los empleados rotan de banda cada ciclo (péndulo M→T→N→T→M). Distribuye el desgaste nocturno.</div>
                                                            <div className="rounded-lg bg-slate-100 px-2.5 py-2 text-slate-700"><strong>OFF</strong> (banda fija) — cada empleado mantiene su turno todo el mes. Más predecible para el guardia.</div>
                                                        </div>
                                                        <p className="text-[9px] text-slate-400 font-bold">El cerebro decide automáticamente. Podés forzarlo acá.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'sixone' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-emerald-800 mb-2">Ciclo 6+1 · banda fija</p>
                                                        <p className="text-[11px] font-bold text-slate-700 mb-2">Ciclo de <strong>7 días</strong>: 6 de trabajo + 1 franco. Eficiencia <strong>85.7%</strong> (vs 75% del 6+2).</p>
                                                        <div className="text-[10px] font-mono font-bold text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2 mb-2">LLLLLLF · LLLLLLF · LLLLLLF…</div>
                                                        <p className="text-[10px] font-bold text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">Más horas facturables por mes, pero menos descanso acumulado. Requiere múltiplo de 6 guardias.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'contingency' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-violet-800 mb-2">Contingencia — Modo 12 manual</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Seleccioná fechas para activar <strong>D12+N12</strong> y liberar RETs ese día. Útil para eventos o picos de demanda.</p>
                                                        <p className="text-[10px] font-bold text-slate-600 mb-2">El motor reorganiza quién trabaja — <strong>no convierte francos en turnos</strong>.</p>
                                                        <p className="text-[10px] font-bold text-violet-700 bg-violet-50 rounded-lg px-2.5 py-2">Los días con V/L/E en la dotación ya activan Modo 12 automáticamente.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'intensive' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-violet-800 mb-2">Intensivo mes completo</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Combina ciclos cortos (4+2, 6+1) para maximizar días de trabajo y horas facturables. Genera más RETs disponibles.</p>
                                                        <p className="text-[10px] font-bold text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">⚠ Requiere turnos rotativos ON. Solo para objetivos con alta demanda continua donde el 6+2 no alcanza.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'gemini' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-indigo-800 mb-2">Ajuste fino IA (Gemini)</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Después de generar, <strong>Gemini</strong> revisa y aplica micro-ajustes para mejorar la distribución de horas y cerrar huecos pequeños. No regenera desde cero.</p>
                                                        <p className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-lg px-2.5 py-2">Demora 30–60 segundos extra. Opcional.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'absences' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-amber-800 mb-2">Ausencias en el mes</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Empleados con V/L/E/A/PG reducen la dotación disponible. Tenés dos herramientas para compensar:</p>
                                                        <div className="space-y-1.5 text-[10px] font-bold text-slate-600 mb-3">
                                                            <div className="flex items-start gap-2"><span className="text-violet-600 font-black shrink-0">D12 auto</span><span>El cerebro activa D12+N12 automáticamente en días V/L/E. No necesitás agregarlo a contingencia manual.</span></div>
                                                            <div className="flex items-start gap-2"><span className="text-teal-600 font-black shrink-0">Cob. Auto</span><span>Asigna automáticamente el RET disponible del mismo objetivo a la banda del ausente (M→M, N→N, etc.).</span></div>
                                                        </div>
                                                        <p className="text-[10px] font-bold text-teal-700 bg-teal-50 rounded-lg px-2.5 py-2">Activá <strong>Cobertura de ausencias</strong> para que el RET libre cubra la banda automáticamente.</p>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Diagnóstico (si el cerebro ya corrió) */}
                                            {autoPlanningBrainReport?.diagnosis && (
                                                <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 space-y-2">
                                                    <p className="text-[9px] font-black uppercase tracking-wide text-indigo-500">Diagnóstico del esquema</p>
                                                    <div className="grid grid-cols-2 gap-1.5">
                                                        <div className="rounded-lg bg-white/90 border border-indigo-100 px-2 py-1.5">
                                                            <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Demanda</p>
                                                            <p className="text-[10px] font-bold text-slate-800">{autoPlanningBrainReport.diagnosis.demand.slotsPerDay} slots/día · {Math.round(autoPlanningBrainReport.diagnosis.demand.soldHours)}h vendidas</p>
                                                        </div>
                                                        <div className="rounded-lg bg-white/90 border border-indigo-100 px-2 py-1.5">
                                                            <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Oferta</p>
                                                            <p className="text-[10px] font-bold text-slate-800">
                                                                {autoPlanningBrainReport.diagnosis.supply.paddingLegajos
                                                                    ? `${autoPlanningBrainReport.diagnosis.supply.realLegajos ?? autoPlanningBrainReport.diagnosis.supply.peopleAvailable} reales + ${autoPlanningBrainReport.diagnosis.supply.paddingLegajos} ref. SLA = ${autoPlanningBrainReport.diagnosis.supply.peopleAvailable} guardias`
                                                                    : `${autoPlanningBrainReport.diagnosis.supply.peopleAvailable} guardias`}
                                                                {' · plantilla 6+2: '}{autoPlanningBrainReport.diagnosis.supply.plantillaRequired6x2}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className={`rounded-lg px-2.5 py-1.5 border text-[10px] font-bold ${autoPlanningBrainReport.diagnosis.balance === 'exact' ? 'bg-emerald-100 border-emerald-300 text-emerald-900' : autoPlanningBrainReport.diagnosis.balance === 'surplus' ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-rose-100 border-rose-300 text-rose-900'}`}>
                                                        <span className="text-[9px] uppercase opacity-70">Balance · </span>{autoPlanningBrainReport.diagnosis.balanceLabel}
                                                        {autoPlanningBrainReport.strictSixTwo && <span className="block text-[9px] mt-0.5 text-emerald-700">6+2 estricto · bandas fijas + flotante</span>}
                                                    </div>
                                                    {autoPlanningBrainReport.recommendedAlternative && !autoAjustarCrono && (
                                                        <button type="button" onClick={() => {
                                                            const alt = autoPlanningBrainReport.recommendedAlternative!;
                                                            const baseInput = autoPlanningBrainInputRef.current;
                                                            if (!baseInput) return;
                                                            const newBrain = resolveAutoPlanningBrain({ ...baseInput, cycleOverride: alt });
                                                            autoPlanningBrainRef.current = newBrain;
                                                            setAutoPlanningBrainReport(newBrain);
                                                            autoSelectedCyclesRef.current = newBrain.cycles;
                                                            setAutoCycles(newBrain.cycles);
                                                        }} className="w-full text-left text-[10px] font-bold rounded-lg px-2 py-1.5 bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors">
                                                            💡 <strong>{autoPlanningBrainReport.recommendedAlternative}</strong> también es viable — clic para aplicar
                                                        </button>
                                                    )}
                                                    {/* Acción rápida: sobran personas → desasignar del objetivo */}
                                                    {autoPlanningBrainReport.diagnosis.balance === 'surplus' && (autoPlanningBrainReport.diagnosis.headcountDelta ?? 0) > 0 && (
                                                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 space-y-1">
                                                            <p className="text-[9px] font-black uppercase text-amber-800">Sobra personal · desasignar del objetivo</p>
                                                            <div className="max-h-28 overflow-y-auto space-y-0.5">
                                                                {planningDotacionEmployees.map(emp => (
                                                                    <div key={emp.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white border border-amber-100">
                                                                        <span className="text-[10px] font-bold text-slate-800 truncate">{emp.nombre || emp.name}</span>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleUnassignEmployee(emp).then(() => setAutoWizardStep('configure'))}
                                                                            className="shrink-0 text-[9px] font-black text-rose-600 hover:text-rose-800 uppercase px-1.5 py-0.5 rounded bg-rose-50 border border-rose-200 hover:border-rose-400 transition-colors"
                                                                        >Quitar</button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {/* Acción rápida: faltan personas → asignar sin objetivo */}
                                                    {(autoPlanningBrainReport.diagnosis.balance === 'short' || autoPlanningBrainReport.diagnosis.balance === 'hours_short') && (
                                                        <div className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 space-y-1">
                                                            <p className="text-[9px] font-black uppercase text-rose-800">Falta personal · incorporar al objetivo</p>
                                                            {(() => {
                                                                const pool = employees.filter((e: any) => e.status !== 'inactivo' && (!e.preferredObjectiveId || e.preferredObjectiveId === ''));
                                                                if (!pool.length) return <p className="text-[10px] text-rose-700 font-bold">No hay empleados sin objetivo en la empresa.</p>;
                                                                return (
                                                                    <div className="max-h-28 overflow-y-auto space-y-0.5">
                                                                        {pool.map((emp: any) => (
                                                                            <div key={emp.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white border border-rose-100">
                                                                                <span className="text-[10px] font-bold text-slate-800 truncate">{emp.nombre || emp.name}</span>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={async () => {
                                                                                        await updateDoc(doc(db, 'empleados', emp.id), { preferredObjectiveId: selectedObjective });
                                                                                        toast.success(`${emp.nombre || emp.name} incorporado al objetivo`);
                                                                                        setAutoWizardStep('configure');
                                                                                    }}
                                                                                    className="shrink-0 text-[9px] font-black text-emerald-600 hover:text-emerald-800 uppercase px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 hover:border-emerald-400 transition-colors"
                                                                                >Asignar</button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Progreso — detectando o generando */}
                                {(autoWizardStep === 'detecting' || autoV2Loading || autoV2Generating || autoV2GeminiLoading) && (
                                    <div className="rounded-xl bg-slate-900 px-4 py-4 text-white shadow-inner ring-1 ring-slate-700/80">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-[11px] font-black uppercase tracking-wide text-amber-300">
                                                {autoV2GeminiLoading ? 'Ajuste fino IA…' : autoV2Generating ? 'Generando cronograma…' : 'Analizando configuración…'}
                                            </span>
                                            <span className="text-[11px] font-mono font-bold text-slate-300">{Math.round(autoV2Progress?.pct ?? 0)}%</span>
                                        </div>
                                        <div className="h-2.5 rounded-full bg-slate-700 overflow-hidden mb-2">
                                            <div className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-300 ease-out ${autoV2Generating ? 'from-emerald-500 to-emerald-300' : 'from-amber-500 to-amber-300'}`}
                                                style={{ width: `${Math.min(100, Math.max(0, autoV2Progress?.pct ?? 3))}%` }}/>
                                        </div>
                                        <p className="text-[11px] font-medium text-slate-300 leading-snug">{autoV2Progress?.label ?? 'Procesando…'}</p>
                                    </div>
                                )}

                                {/* No viable */}
                                {autoWizardStep === 'verified' && autoV2Report && !autoV2Report.ok && (
                                    <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-3">
                                        <p className="text-sm font-black text-rose-800 mb-3">✗ Dotación insuficiente para cubrir el SLA</p>
                                        <div className="grid grid-cols-2 gap-2 mb-3">
                                            <div className="bg-white rounded-lg p-2 border border-slate-200">
                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Demanda SLA</div>
                                                <div className="text-lg font-black text-rose-700">{Math.round(autoV2Report.metrics.contractedHours)}<span className="text-xs">h</span></div>
                                            </div>
                                            <div className="bg-white rounded-lg p-2 border border-slate-200">
                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Oferta disponible</div>
                                                <div className="text-lg font-black text-rose-700">{Math.round(autoV2Report.metrics.offerHours)}<span className="text-xs">h</span></div>
                                                <div className="text-[9px] font-black text-rose-600 mt-0.5">{Math.round(autoV2Report.metrics.offerHours - autoV2Report.metrics.effectiveTargetHours)}h faltantes</div>
                                            </div>
                                            <div className="bg-white rounded-lg p-2 border border-slate-200">
                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Personas necesarias</div>
                                                <div className="text-lg font-black text-rose-700">{autoV2Report.metrics.peopleNeededForTarget}</div>
                                                <div className="text-[9px] text-slate-400 font-bold mt-0.5">ciclo {autoV2Report.metrics.cycleUsed}: ~{autoV2Report.metrics.peopleSuggestedWithCycle}</div>
                                            </div>
                                            <div className="bg-white rounded-lg p-2 border border-slate-200">
                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Personas disponibles</div>
                                                <div className="text-lg font-black text-slate-800">{autoV2Report.metrics.peopleAvailable}</div>
                                            </div>
                                        </div>
                                        {autoV2Report.reasons.length > 0 && (
                                            <ul className="list-disc list-inside space-y-0.5 text-[11px] font-bold text-rose-800">
                                                {autoV2Report.reasons.map((r, i) => <li key={i}>{r}</li>)}
                                            </ul>
                                        )}
                                        {/* Acción rápida: incorporar empleados sin objetivo */}
                                        {(() => {
                                            const pool = employees.filter((e: any) => e.status !== 'inactivo' && (!e.preferredObjectiveId || e.preferredObjectiveId === ''));
                                            if (!pool.length) return null;
                                            return (
                                                <div className="mt-3 rounded-lg border border-rose-300 bg-white px-2 py-1.5 space-y-1">
                                                    <p className="text-[9px] font-black uppercase text-rose-800">Incorporar al objetivo · sin objetivo asignado</p>
                                                    <div className="max-h-28 overflow-y-auto space-y-0.5">
                                                        {pool.map((emp: any) => (
                                                            <div key={emp.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-rose-50 border border-rose-100">
                                                                <span className="text-[10px] font-bold text-slate-800 truncate">{emp.nombre || emp.name}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={async () => {
                                                                        await updateDoc(doc(db, 'empleados', emp.id), { preferredObjectiveId: selectedObjective });
                                                                        toast.success(`${emp.nombre || emp.name} incorporado — volvé a analizar`);
                                                                        setAutoWizardStep('configure');
                                                                    }}
                                                                    className="shrink-0 text-[9px] font-black text-emerald-600 hover:text-emerald-800 uppercase px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 hover:border-emerald-400 transition-colors"
                                                                >Asignar</button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                )}

                                {autoWizardStep === 'sla_open' && !autoV2Generating && (
                                    <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-3">
                                        <p className="text-sm font-black text-rose-800 mb-1">✗ Cobertura sin cerrar — vista previa</p>
                                        <p className="text-[11px] font-bold text-rose-700 leading-snug">
                                            El cronograma calculado ya está en la grilla (celdas pendientes). Cerrá este modal para revisarlo.
                                            No publiques ni guardes como definitivo hasta cerrar el SLA.
                                        </p>
                                    </div>
                                )}

                                {(autoPlanningBrainReport?.serviceAnalysis ?? objectiveServiceAnalysis)
                                    && (autoWizardStep === 'configure' || autoWizardStep === 'verified' || autoWizardStep === 'done' || autoWizardStep === 'sla_open')
                                    && !autoV2Loading && !autoV2Generating && (
                                    <ObjectiveServiceAnalysisCard
                                        analysis={autoPlanningBrainReport?.serviceAnalysis ?? objectiveServiceAnalysis!}
                                    />
                                )}

                                {autoPlanningBrainReport?.diagnosis && (autoWizardStep === 'configure' || autoWizardStep === 'verified' || autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Loading && !autoV2Generating && (
                                    <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/80 px-3 py-2.5 space-y-2">
                                        <p className="text-[10px] font-black text-indigo-800 uppercase tracking-wide">Diagnóstico operativo</p>
                                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                                            <div className="rounded-lg bg-white/90 border border-indigo-100 px-2 py-1.5">
                                                <p className="font-black text-slate-500 uppercase text-[9px]">Demanda</p>
                                                <p className="font-bold text-slate-800">{autoPlanningBrainReport.diagnosis.demand.slotsPerDay} slots/día · {autoPlanningBrainReport.diagnosis.demand.slotsMonth} mes</p>
                                                <p className="text-slate-600">{Math.round(autoPlanningBrainReport.diagnosis.demand.structuralHours)}h estructura · {Math.round(autoPlanningBrainReport.diagnosis.demand.soldHours)}h vendidas</p>
                                                {autoPlanningBrainReport.diagnosis.demand.modo12DayCount > 0 && (
                                                    <p className="text-amber-700 font-bold">{autoPlanningBrainReport.diagnosis.demand.modo12DayCount} día(s) Modo 12</p>
                                                )}
                                            </div>
                                            <div className="rounded-lg bg-white/90 border border-indigo-100 px-2 py-1.5">
                                                <p className="font-black text-slate-500 uppercase text-[9px]">Oferta</p>
                                                <p className="font-bold text-slate-800">
                                                    {autoPlanningBrainReport.diagnosis.supply.paddingLegajos
                                                        ? `${autoPlanningBrainReport.diagnosis.supply.realLegajos ?? autoPlanningBrainReport.diagnosis.supply.peopleAvailable} reales + ${autoPlanningBrainReport.diagnosis.supply.paddingLegajos} ref. SLA = ${autoPlanningBrainReport.diagnosis.supply.peopleAvailable} guardias`
                                                        : `${autoPlanningBrainReport.diagnosis.supply.peopleAvailable} guardias`}
                                                    {' · '}{Math.round(autoPlanningBrainReport.diagnosis.supply.offerHours)}h max
                                                </p>
                                                <p className="text-slate-600">T1 {Math.round(autoPlanningBrainReport.diagnosis.supply.offerHoursT1)}h · T2 {Math.round(autoPlanningBrainReport.diagnosis.supply.offerHoursT2)}h</p>
                                                <p className="text-slate-600">Plantilla 6+2: {autoPlanningBrainReport.diagnosis.supply.servicioDiario}+{autoPlanningBrainReport.diagnosis.supply.poolFrancos6x2}={autoPlanningBrainReport.diagnosis.supply.plantillaRequired6x2}</p>
                                            </div>
                                        </div>
                                        <div className={`rounded-lg px-2 py-1.5 border text-[10px] font-bold ${
                                            autoPlanningBrainReport.diagnosis.balance === 'exact'
                                                ? 'bg-emerald-100 border-emerald-300 text-emerald-900'
                                                : autoPlanningBrainReport.diagnosis.balance === 'surplus'
                                                    ? 'bg-amber-100 border-amber-300 text-amber-900'
                                                    : 'bg-rose-100 border-rose-300 text-rose-900'
                                        }`}>
                                            <span className="uppercase text-[9px] opacity-80">Balance · </span>
                                            {autoPlanningBrainReport.diagnosis.balanceLabel}
                                            {autoPlanningBrainReport.strictSixTwo && (
                                                <span className="block mt-0.5 text-emerald-800">6+2 estricto — ciclo M→T→N + continuidad mes anterior</span>
                                            )}
                                        </div>
                                        <p className="text-[10px] font-bold text-indigo-900 leading-snug">{autoPlanningBrainReport.diagnosis.resolution}</p>
                                    </div>
                                )}

                                {autoPlanningBrainReport && (autoWizardStep === 'verified' || autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Loading && (
                                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1.5">
                                        <p className="text-[10px] font-black text-slate-600 uppercase tracking-wide">Cerebro Auto — dotación diaria</p>
                                        <p className="text-[11px] font-bold text-slate-800">
                                            Modo 8: <strong>{autoPlanningBrainReport.staffing.servicioDiarioModo8}</strong> servicio
                                            + <strong>{autoPlanningBrainReport.staffing.poolFrancos}</strong> franco
                                            = <strong>{autoPlanningBrainReport.staffing.plantillaTotal}</strong> plantilla
                                            {autoPlanningBrainReport.serviceAnalysis?.kind === 'mixed' ? (
                                                <span className="text-slate-500 font-bold block mt-0.5">
                                                    Ciclos: 24 HS {autoPlanningBrainReport.pickedCycle} · Custom{' '}
                                                    {autoPlanningBrainReport.serviceAnalysis.cycleBlocks.custom}
                                                </span>
                                            ) : (
                                                <span className="text-slate-500 font-bold"> ({autoPlanningBrainReport.pickedCycle})</span>
                                            )}
                                        </p>
                                        <p className="text-[10px] font-bold text-slate-500">
                                            Modo 12: {autoPlanningBrainReport.staffing.servicioDiarioModo12} en servicio (D12/N12)
                                            · rotativo {autoPlanningBrainReport.rotateShifts ? 'ON' : 'OFF'}
                                        </p>
                                        {autoPlanningBrainReport.modo12DaysAuto.length > 0 && (
                                            <p className={`text-[10px] font-bold rounded px-2 py-1 ${autoPlanningBrainReport.absenceModo12Ok ? 'text-amber-800 bg-amber-50' : 'text-rose-800 bg-rose-50'}`}>
                                                Ausencias V/L/E: {autoPlanningBrainReport.modo12DaysAuto.length} día(s) Modo 12
                                                {autoPlanningBrainReport.absenceModo12Ok ? ' · plantilla objetivo' : ' · revisar (sin franco extra)'}
                                            </p>
                                        )}
                                        {autoPlanningBrainReport.contingencyDaysManual.length > 0 && (
                                            <p className={`text-[10px] font-bold rounded px-2 py-1 ${autoPlanningBrainReport.contingencyOk ? 'text-violet-800 bg-violet-50' : 'text-rose-800 bg-rose-50'}`}>
                                                Contingencia: {autoPlanningBrainReport.contingencyDaysManual.length} día(s)
                                                {autoPlanningBrainReport.contingencyOk ? ' · viable' : ' · no viable'}
                                            </p>
                                        )}
                                        {autoPlanningBrainReport.recommendedAlternative && !autoAjustarCrono && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const alt = autoPlanningBrainReport.recommendedAlternative!;
                                                    const baseInput = autoPlanningBrainInputRef.current;
                                                    if (!baseInput) return;
                                                    const newBrain = resolveAutoPlanningBrain({ ...baseInput, cycleOverride: alt });
                                                    autoPlanningBrainRef.current = newBrain;
                                                    setAutoPlanningBrainReport(newBrain);
                                                    autoSelectedCyclesRef.current = newBrain.cycles;
                                                    setAutoCycles(newBrain.cycles);
                                                }}
                                                className="w-full text-left text-[10px] font-bold rounded px-2 py-1.5 bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
                                            >
                                                💡 <strong>{autoPlanningBrainReport.recommendedAlternative}</strong> también es viable — clic para aplicar
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Resultado: 3 tarjetas */}
                                {(autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && autoV2GenStats && autoCycles.length > 0 && (
                                    <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 mb-1">
                                        <p className="text-[10px] font-black text-indigo-700 uppercase tracking-wide">
                                            {autoWizardStep === 'sla_open' ? 'Esquema calculado' : 'Esquema aplicado'}
                                        </p>
                                        <p className="text-sm font-black text-indigo-900">{autoCycles.join(' · ')} <span className="text-[10px] font-bold text-indigo-600">(auto)</span></p>
                                    </div>
                                )}

                                {(autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && autoV2GenStats && slaVendidas > 0 && (
                                    <div className={`rounded-lg border px-3 py-2 text-[11px] font-bold ${
                                        autoV2GenStats.slaHoursClosed
                                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                            : 'border-rose-300 bg-rose-50 text-rose-800'
                                    }`}>
                                        {autoV2GenStats.slaHoursClosed
                                            ? `✓ SLA cerrado: ${Math.round(autoV2GenStats.totalBillableHours)}h planificadas = ${slaVendidas}h vendidas`
                                            : (() => {
                                                const hrs = Math.round(
                                                    autoV2GenStats.slaDeficitRemaining
                                                    ?? Math.max(0, slaVendidas - autoV2GenStats.totalBillableHours),
                                                );
                                                const slots = autoV2Coverage?.coverage.uncoveredSlots
                                                    ?? autoV2GenStats.uncoveredSlots ?? 0;
                                                const parts: string[] = [];
                                                if (hrs > 0) parts.push(`${hrs}h`);
                                                if (slots > 0) parts.push(`${slots} slot${slots !== 1 ? 's' : ''} sin cubrir`);
                                                const detail = parts.length > 0 ? parts.join(' · ') : 'revisar cobertura';
                                                return `✗ SLA abierto: ${detail} (${slaVendidas}h vendidas, ${Math.round(autoV2GenStats.totalBillableHours)}h planificadas)`;
                                            })()}
                                    </div>
                                )}

                                {(autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && autoV2GenStats && (
                                    <div className="grid grid-cols-3 gap-2">
                                        <div className={`bg-white rounded-xl p-3 border-2 text-center ${
                                            autoV2GenStats.gridBillableHours != null
                                            && Math.abs(autoV2GenStats.totalBillableHours - autoV2GenStats.gridBillableHours) > 16
                                                ? 'border-amber-400' : 'border-slate-200'
                                        }`}>
                                            <div className="text-[9px] font-black uppercase tracking-wide text-slate-500 mb-1">Hs facturables</div>
                                            <div className="text-2xl font-black text-indigo-700">{Math.round(autoV2GenStats.totalBillableHours)}<span className="text-sm">h</span></div>
                                            {autoV2GenStats.gridBillableHours != null
                                                && Math.abs(autoV2GenStats.totalBillableHours - autoV2GenStats.gridBillableHours) > 16 && (
                                                <div className="text-[9px] font-bold text-amber-700 mt-0.5">
                                                    Grilla: {Math.round(autoV2GenStats.gridBillableHours)}h
                                                </div>
                                            )}
                                        </div>
                                        <div className="bg-white rounded-xl p-3 border-2 border-slate-200 text-center">
                                            <div className="text-[9px] font-black uppercase tracking-wide text-slate-500 mb-1">Cubiertos</div>
                                            <div className={`text-2xl font-black ${(autoV2Coverage?.coverage.uncoveredSlots ?? 0) === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                                                {autoV2Coverage ? `${autoV2Coverage.coverage.coveredSlots}/${autoV2Coverage.coverage.totalSlots}` : '—'}
                                            </div>
                                        </div>
                                        <div className={`bg-white rounded-xl p-3 border-2 text-center ${(autoV2Coverage?.coverage.uncoveredSlots ?? 0) === 0 ? 'border-emerald-300' : 'border-rose-300'}`}>
                                            <div className="text-[9px] font-black uppercase tracking-wide text-slate-500 mb-1">Sin cubrir</div>
                                            <div className={`text-2xl font-black ${(autoV2Coverage?.coverage.uncoveredSlots ?? 0) === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                                {autoV2Coverage?.coverage.uncoveredSlots ?? 0}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Aviso: empleados movidos automáticamente por asignación incorrecta de puestos */}
                                {(autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && (() => {
                                    const relocated = autoV2GenStats?.relocatedEmployeeIds || [];
                                    const stranded  = autoV2GenStats?.strandedEmployeeIds  || [];
                                    if (relocated.length === 0 && stranded.length === 0) return null;
                                    const getName = (id: string) => {
                                        const emp = displayedEmployees.find((e: any) => e.id === id);
                                        return emp ? (emp.name || emp.nombre || id) : id;
                                    };
                                    return (
                                        <div className="rounded-xl border-2 border-orange-400 bg-orange-50 px-3 py-2.5 space-y-2">
                                            <div className="flex items-start gap-2">
                                                <span className="text-orange-600 mt-0.5 text-base font-black">!</span>
                                                <div className="flex-1">
                                                    <p className="text-[11px] font-black text-orange-900 uppercase tracking-wide mb-0.5">
                                                        Puestos con dotación incorrecta — corregidos automáticamente
                                                    </p>
                                                    <p className="text-[10px] text-orange-800 leading-relaxed">
                                                        El engine detectó puestos con más o menos empleados de los necesarios para el ciclo 6+2 (qty × 4 por puesto)
                                                        y rebalanceó la asignación para generar cobertura correcta.
                                                        <strong className="block mt-0.5">Corregí la asignación de puestos en los legajos para que coincida con el SLA.</strong>
                                                    </p>
                                                </div>
                                            </div>
                                            {relocated.length > 0 && (
                                                <div>
                                                    <p className="text-[9px] font-black text-orange-700 uppercase mb-1">
                                                        {relocated.length} movido{relocated.length !== 1 ? 's' : ''} de su puesto (legajo incorrecto):
                                                    </p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {relocated.map((id, i) => (
                                                            <span key={i} className="bg-orange-200 text-orange-900 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase">
                                                                {getName(id)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {stranded.length > 0 && (
                                                <div>
                                                    <p className="text-[9px] font-black text-orange-700 uppercase mb-1">
                                                        {stranded.length} sin puesto válido (faltan empleados en el servicio):
                                                    </p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {stranded.map((id, i) => (
                                                            <span key={i} className="bg-amber-200 text-amber-900 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase">
                                                                {getName(id)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* Panel de cobertura de ausencias — visible si hay gaps (siempre se analiza con pipeline floater) */}
                                {(autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && autoCoverageGaps.length > 0 && (() => {
                                    const bandMeta: Record<string, { name: string; hours: number; startTime: string; endTime: string }> = {
                                        M: { name: 'Mañana',   hours: 8, startTime: '07:00', endTime: '15:00' },
                                        T: { name: 'Tarde',    hours: 8, startTime: '15:00', endTime: '23:00' },
                                        N: { name: 'Noche',    hours: 8, startTime: '23:00', endTime: '07:00' },
                                        D12:{ name: 'Diurno',  hours:12, startTime: '07:00', endTime: '19:00' },
                                        N12:{ name: 'Nocturno',hours:12, startTime: '19:00', endTime: '07:00' },
                                    };

                                    const assignGap = (candidateEmpId: string, candidateName: string, dateStr: string, band: string, absentEmpId: string) => {
                                        const meta = bandMeta[band] ?? bandMeta.M;
                                        const posName = positionStructure[0]?.positionName ?? 'General';
                                        // Actualizar grilla: cambiar el turno del candidato en ese día
                                        setPendingChanges(prev => ({
                                            ...prev,
                                            [`${candidateEmpId}_${dateStr}`]: {
                                                isTemp: true,
                                                employeeId: candidateEmpId,
                                                objectiveId: selectedObjective,
                                                positionName: posName,
                                                code: band,
                                                name: meta.name,
                                                hours: meta.hours,
                                                startTime: meta.startTime,
                                                endTime: meta.endTime,
                                                isFranco: false,
                                            },
                                        }));
                                        // Marcar gap como cubierto manualmente
                                        setAutoCoverageGaps(prev => prev.map(g =>
                                            g.absentEmpId === absentEmpId && g.dateStr === dateStr
                                                ? { ...g, coverageType: 'manual' as const, coveredBy: candidateEmpId, coveredByName: candidateName }
                                                : g
                                        ));
                                        toast.success(`Día ${dateStr.slice(8,10)}: ${candidateName.split(',')[0]} asignado a banda ${band}`, { duration: 3000 });
                                    };

                                    const coveredGaps = autoCoverageGaps.filter(g => g.coveredBy !== null);
                                    const ftGaps = autoCoverageGaps.filter(g => g.coverageType === 'ft_required');

                                    const ftByEmp: Record<string, { nombre: string; days: typeof ftGaps }> = {};
                                    for (const g of ftGaps) {
                                        if (!ftByEmp[g.absentEmpId]) ftByEmp[g.absentEmpId] = { nombre: g.absentName || g.absentEmpId, days: [] };
                                        ftByEmp[g.absentEmpId].days.push(g);
                                    }

                                    const coverLabel = (type: string) =>
                                        type === 'ret' ? 'RET' : type === 'esc' ? 'ESC' : type === 'sin_turno' ? 'ST' : type === 'manual' ? 'MANUAL' : type === 'ft_required' ? 'FT' : type.toUpperCase();

                                    return (
                                        <div className="rounded-xl border-2 border-amber-200 bg-amber-50/80 px-3 py-2.5 space-y-2.5">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[10px] font-black uppercase tracking-wide text-amber-800">Cobertura ausencias</p>
                                                <div className="flex gap-1 flex-wrap">
                                                    {coveredGaps.length > 0 && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-teal-100 text-teal-800">{coveredGaps.length} cubiertos ✓</span>}
                                                    {ftGaps.length > 0 && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">{ftGaps.length} sin cubrir</span>}
                                                    {!autoCoverAbsences && ftGaps.length > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">activá cobertura auto</span>}
                                                </div>
                                            </div>

                                            {/* Sin cobertura ST/RET/ESC → filas clicables multi-selección */}
                                            {ftGaps.length > 0 && (() => {
                                                const allFtKeys = ftGaps.map(g => `${g.absentEmpId}_${g.dateStr}`);
                                                const someSelected = allFtKeys.some(k => coverageSelectedDays.has(k));
                                                const allSelected = allFtKeys.every(k => coverageSelectedDays.has(k));
                                                const selectedGaps = ftGaps.filter(g => coverageSelectedDays.has(`${g.absentEmpId}_${g.dateStr}`));
                                                const toggle = (key: string) => setCoverageSelectedDays(prev => {
                                                    const next = new Set(prev);
                                                    next.has(key) ? next.delete(key) : next.add(key);
                                                    return next;
                                                });
                                                return (
                                                    <div className="space-y-1.5">
                                                        <div className="flex items-center justify-between">
                                                            <p className="text-[9px] font-black text-rose-800">Seleccioná días a cubrir:</p>
                                                            <button
                                                                type="button"
                                                                onClick={() => setCoverageSelectedDays(allSelected
                                                                    ? new Set()
                                                                    : new Set(allFtKeys)
                                                                )}
                                                                className="text-[9px] font-black text-indigo-600 hover:text-indigo-800"
                                                            >
                                                                {allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                                                            </button>
                                                        </div>
                                                        {Object.values(ftByEmp).map(({ nombre, days }) => (
                                                            <div key={days[0].absentEmpId} className="rounded-lg border border-rose-200 bg-white overflow-hidden">
                                                                <div className="px-2.5 py-1.5 bg-rose-50 border-b border-rose-100">
                                                                    <p className="text-[9px] font-black text-rose-800">{nombre}</p>
                                                                </div>
                                                                {days.map(gap => {
                                                                    const key = `${gap.absentEmpId}_${gap.dateStr}`;
                                                                    const isChecked = coverageSelectedDays.has(key);
                                                                    return (
                                                                        <button
                                                                            key={gap.dateStr}
                                                                            type="button"
                                                                            onClick={() => toggle(key)}
                                                                            className={`w-full flex items-center justify-between px-3 py-2 border-b border-slate-100 last:border-b-0 transition-colors text-left ${
                                                                                isChecked
                                                                                    ? 'bg-indigo-600 text-white'
                                                                                    : 'bg-white hover:bg-slate-50 text-slate-700'
                                                                            }`}
                                                                        >
                                                                            <span className="text-[10px] font-bold">
                                                                                Día {gap.dateStr.slice(8, 10)} · {gap.band}
                                                                            </span>
                                                                            <span className={`text-[9px] font-black ${isChecked ? 'text-white/80' : 'text-slate-400'}`}>
                                                                                {isChecked ? '✓' : '○'}
                                                                            </span>
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        ))}
                                                        <button
                                                            type="button"
                                                            disabled={!someSelected}
                                                            onClick={() => someSelected && setPlanCoverageModalGaps(selectedGaps)}
                                                            className={`w-full py-2.5 rounded-lg text-[10px] font-black transition-colors ${
                                                                someSelected
                                                                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                                            }`}
                                                        >
                                                            {someSelected
                                                                ? `Asignar cobertura — ${selectedGaps.length} día(s) seleccionado(s)`
                                                                : 'Seleccioná al menos un día'}
                                                        </button>
                                                    </div>
                                                );
                                            })()}

                                            {/* Cubiertos: ST / RET / ESC / FT / manual */}
                                            {coveredGaps.length > 0 && (
                                                <div className="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1.5 space-y-0.5">
                                                    <p className="text-[9px] font-black text-teal-800 mb-1">✓ Cubiertos</p>
                                                    {coveredGaps.map(g => (
                                                        <div key={`${g.absentEmpId}_${g.dateStr}`} className="flex justify-between text-[9px] font-bold text-teal-700">
                                                            <span>{g.absentName?.split(',')[0]} · día {g.dateStr.slice(8,10)} · {g.band}</span>
                                                            <span>{g.coveredByName?.split(',')[0]} ({coverLabel(g.coverageType)})</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {autoV2FormReport && (autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && (
                                    <div className={`rounded-xl border-2 px-3 py-2.5 space-y-2 ${
                                        autoV2FormReport.ok
                                            ? 'border-emerald-200 bg-emerald-50/90'
                                            : autoV2FormReport.warnings
                                                ? 'border-amber-200 bg-amber-50/90'
                                                : 'border-rose-200 bg-rose-50/90'
                                    }`}>
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="text-[10px] font-black uppercase tracking-wide text-slate-700">
                                                Calidad forma 6+2
                                            </p>
                                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                                                autoV2FormReport.ok ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-200 text-amber-900'
                                            }`}>
                                                {autoV2FormReport.metrics.formCompliantPct}% limpias
                                            </span>
                                        </div>
                                        <p className="text-[10px] font-bold text-slate-800 leading-snug">{autoV2FormReport.summary}</p>
                                        <div className="grid grid-cols-4 gap-1 text-[9px] font-bold text-slate-600">
                                            <span>Prom {autoV2FormReport.metrics.avgBillableHours}h</span>
                                            <span>{autoV2FormReport.metrics.minBillableHours}–{autoV2FormReport.metrics.maxBillableHours}h</span>
                                            <span>Δ {autoV2FormReport.metrics.hoursSpread}h</span>
                                            <span>&gt;200h: {autoV2FormReport.metrics.over200Count}</span>
                                        </div>
                                        {(autoV2FormReport.metrics.workBlockIssues > 0
                                            || autoV2FormReport.metrics.francoBlockIssues > 0
                                            || autoV2FormReport.metrics.rotationStuckCount > 0
                                            || autoV2FormReport.metrics.weeklyOver48Count > 0) && (
                                            <div className="flex flex-wrap gap-1">
                                                {autoV2FormReport.metrics.workBlockIssues > 0 && (
                                                    <span className="text-[9px] font-bold bg-white/80 px-1.5 py-0.5 rounded border border-slate-200">
                                                        bloques ≠6d: {autoV2FormReport.metrics.workBlockIssues}
                                                    </span>
                                                )}
                                                {autoV2FormReport.metrics.francoBlockIssues > 0 && (
                                                    <span className="text-[9px] font-bold bg-white/80 px-1.5 py-0.5 rounded border border-slate-200">
                                                        FF ≠2: {autoV2FormReport.metrics.francoBlockIssues}
                                                    </span>
                                                )}
                                                {autoV2FormReport.metrics.rotationStuckCount > 0 && (
                                                    <span className="text-[9px] font-bold bg-white/80 px-1.5 py-0.5 rounded border border-slate-200">
                                                        banda fija: {autoV2FormReport.metrics.rotationStuckCount}
                                                    </span>
                                                )}
                                                {autoV2FormReport.metrics.weeklyOver48Count > 0 && (
                                                    <span className="text-[9px] font-bold bg-white/80 px-1.5 py-0.5 rounded border border-slate-200">
                                                        sem &gt;48h: {autoV2FormReport.metrics.weeklyOver48Count}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {autoV2FormReport.issues.length > 0 && (
                                            <ul className="max-h-28 overflow-y-auto text-[9px] font-bold text-slate-700 space-y-0.5 border-t border-slate-200/80 pt-1.5">
                                                {autoV2FormReport.issues.slice(0, 12).map((issue, i) => (
                                                    <li key={`${issue.empId}-${issue.kind}-${i}`} className={issue.severity === 'error' ? 'text-rose-800' : 'text-amber-800'}>
                                                        {issue.empName || issue.empId.slice(-6)}: {issue.message}
                                                    </li>
                                                ))}
                                                {autoV2FormReport.issues.length > 12 && (
                                                    <li className="text-slate-500">… y {autoV2FormReport.issues.length - 12} más</li>
                                                )}
                                            </ul>
                                        )}
                                        {(autoV2FormReport.metrics.hoursSpread > 24
                                            || autoV2FormReport.metrics.over192Count > 0
                                            || autoV2FormReport.metrics.under168Count > 0)
                                            && (autoV2Coverage?.coverage.uncoveredSlots ?? 0) === 0
                                            && autoWizardStep === 'done'
                                            && !autoPlanningBrainRef.current?.strictSixTwo
                                            && !autoSelectedCyclesRef.current?.includes('6+2') && (
                                            <button
                                                type="button"
                                                onClick={() => void rebalanceAutoForm()}
                                                disabled={autoV2Rebalancing || autoV2Generating}
                                                className="w-full mt-1 flex items-center justify-center gap-1.5 rounded-lg border-2 border-indigo-300 bg-indigo-50 px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                                            >
                                                {autoV2Rebalancing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowLeftRight className="w-3 h-3" />}
                                                Rebalancear forma (swaps)
                                            </button>
                                        )}
                                        {autoV2RebalanceLog.length > 0 && (
                                            <ul className="max-h-20 overflow-y-auto text-[9px] font-bold text-indigo-800 space-y-0.5 border-t border-indigo-200/80 pt-1.5">
                                                {autoV2RebalanceLog.slice(-6).map((entry, i) => (
                                                    <li key={`${entry.dateStr}-${entry.fromEmpId}-${i}`}>
                                                        {entry.dateStr}: {entry.detail}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )}

                                {autoV2TrailDiag && (autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && (() => {
                                    const diagBandOf = (s: number) => { const n=((s%24)+24)%24; if(n<=5)return'M'; if(n<=7)return'F'; if(n<=13)return'T'; if(n<=15)return'F'; if(n<=21)return'N'; return'F'; };
                                    // Detectar colisiones: misma apertura (banda+diasFranco) entre empleados del mismo puesto
                                    const aperturaKey = (r: typeof autoV2TrailDiag[0]) =>
                                        r.julioBand && r.diasFranco !== undefined ? `${r.puesto}|${r.julioBand}|${r.diasFranco}` : null;
                                    const keyCounts: Record<string, number> = {};
                                    autoV2TrailDiag.forEach(r => { const k = aperturaKey(r); if(k) keyCounts[k] = (keyCounts[k]??0)+1; });
                                    return (
                                        <div className="rounded-xl border-2 border-slate-200 bg-white px-3 py-2 space-y-1.5">
                                            <button
                                                type="button"
                                                onClick={() => setAutoV2ShowTrailDiag(v => !v)}
                                                className="w-full flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-slate-600 hover:text-slate-900"
                                            >
                                                <span>Racha mes anterior → apertura</span>
                                                <span className="text-slate-400">{autoV2ShowTrailDiag ? '▲' : '▼'}</span>
                                            </button>
                                            {autoV2ShowTrailDiag && (
                                                <div className="overflow-x-auto">
                                                    <table className="w-full">
                                                        <thead>
                                                            <tr className="text-[9px] font-black uppercase text-slate-400 border-b border-slate-100">
                                                                <th className="text-left pb-1 pr-2 font-black">Colaborador</th>
                                                                <th className="text-center pb-1 pr-1 font-black">Puesto</th>
                                                                <th className="text-center pb-1 pr-1 font-black">Fin mes ant.</th>
                                                                <th className="text-center pb-1 font-black">Apertura</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {autoV2TrailDiag.map(row => {
                                                                const finMes = row.trailWork > 0
                                                                    ? `${row.trailWork}×${row.lastBand}`
                                                                    : row.trailRest > 0
                                                                        ? `${row.trailRest}×F`
                                                                        : '—';
                                                                const apertura = row.julioBand !== undefined && row.diasFranco !== undefined
                                                                    ? `${row.julioBand} · ${row.diasFranco}d→F`
                                                                    : '—';
                                                                const k = aperturaKey(row);
                                                                // Colisión real solo si hay MÁS empleados con igual apertura que qty del puesto.
                                                                // qty=2 → 2 F·0d en el mismo puesto es normal (1 por subgrupo).
                                                                const isCollision = k !== null && (keyCounts[k] ?? 0) > (row.puestoQty ?? 1);
                                                                const isTruncatedFranco = row.trailRest === 1 && row.julioBand !== 'F';
                                                                const rowClass = isCollision
                                                                    ? 'text-rose-700 bg-rose-50'
                                                                    : isTruncatedFranco
                                                                        ? 'text-amber-700'
                                                                        : 'text-slate-700';
                                                                return (
                                                                    <tr key={row.id} className={`text-[9px] font-bold border-b border-slate-50 ${rowClass}`}>
                                                                        <td className="py-0.5 pr-2 text-left">{row.nombre}</td>
                                                                        <td className="py-0.5 pr-1 text-center text-slate-500">{row.puesto}</td>
                                                                        <td className="py-0.5 pr-1 text-center font-black">{finMes}</td>
                                                                        <td className="py-0.5 text-center font-black">{apertura}</td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                    <p className="text-[8px] text-slate-400 mt-1">Rojo = colisión (más empleados con igual apertura que qty del puesto). Ámbar = franco truncado (1×F → inicio trabajo).</p>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {(autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && autoV2GenStats && (autoV2GenStats.totalRetCount ?? 0) > 0 && (
                                    <div className={`rounded-lg border px-3 py-2 text-[11px] font-bold ${
                                        autoV2GenStats.ajustarCrono ? 'border-violet-300 bg-violet-50 text-violet-900' : 'border-amber-200 bg-amber-50 text-amber-900'
                                    }`}>
                                        <p className="font-black">
                                            Pool RET: {autoV2GenStats.totalRetCount} días-persona
                                            {autoV2GenStats.totalRetHoursPotential
                                                ? ` (~${Math.round(autoV2GenStats.totalRetHoursPotential)}h stand-by potencial)`
                                                : ''}
                                        </p>
                                        {(autoV2GenStats.overCoverageRetDays ?? 0) > 0 && (
                                            <p className="text-[10px] mt-1 opacity-90">
                                                ⚠ {autoV2GenStats.overCoverageRetDays} día(s) con 2+ RET simultáneos
                                                (máx. {autoV2GenStats.maxRetConcurrent ?? 0}) — revisar sobrecobertura en dotación.
                                            </p>
                                        )}
                                        {autoV2GenStats.ajustarCrono && (
                                            <p className="text-[10px] mt-1 opacity-80">
                                                Modo ajustar crono: esquemas intensivos para liberar guardias a otros objetivos / eventos.
                                            </p>
                                        )}
                                        {(autoV2GenStats.apretarCronoDays?.length ?? 0) > 0 && (
                                            <p className="text-[10px] mt-1 opacity-90">
                                                Modo 12 (D12+N12):{' '}
                                                {autoV2GenStats.apretarCronoDays!.map(d => d.slice(8, 10)).join(', ')}
                                                {' '}— ausencias auto y/o Contingencia manual.
                                            </p>
                                        )}
                                    </div>
                                )}

                                {autoWizardStep === 'done' && !autoV2Generating && autoV2GenStats && (
                                    <>
                                        {/* Conflictos / descansos — grilla aplicada */}
                                        {autoV2Coverage && (autoV2Coverage.licenseConflicts.length > 0 || autoV2Coverage.restViolations.length > 0) && (
                                            <div className="flex flex-wrap gap-2">
                                                {autoV2Coverage.licenseConflicts.length > 0 && (
                                                    <span className="text-[11px] font-black text-rose-700 bg-rose-100 px-2 py-1 rounded-lg">
                                                        ⛔ {autoV2Coverage.licenseConflicts.length} conflicto{autoV2Coverage.licenseConflicts.length > 1 ? 's' : ''} de licencia
                                                    </span>
                                                )}
                                                {autoV2Coverage.restViolations.length > 0 && (
                                                    <span className="text-[11px] font-black text-amber-700 bg-amber-100 px-2 py-1 rounded-lg">
                                                        ⚠ {autoV2Coverage.restViolations.length} descanso{autoV2Coverage.restViolations.length > 1 ? 's' : ''} roto{autoV2Coverage.restViolations.length > 1 ? 's' : ''}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {!autoOverwrite && (autoV2GenStats?.cellsSkippedOverwrite ?? 0) > 0 && (
                                            <p className="text-[11px] font-black text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5">
                                                Sobreescribir OFF: {autoV2GenStats?.cellsSkippedOverwrite} celdas no se actualizaron. Lo que ves en la grilla puede no coincidir con el cálculo del modal.
                                            </p>
                                        )}
                                        <p className="text-[11px] text-slate-500 font-bold">
                                            {autoV2Coverage?.ok !== false
                                                ? 'Cronograma listo. Revisá la grilla y guardá cuando estés listo.'
                                                : 'Cronograma con avisos. Revisá la grilla antes de guardar.'}
                                        </p>
                                        {autoV2GeminiSummary && (
                                            <p className="text-[10px] text-indigo-700 font-bold bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1.5">
                                                IA: {autoV2GeminiSummary}
                                            </p>
                                        )}
                                        {autoV2LastRun && autoV2Coverage && (
                                            <button type="button"
                                                disabled={autoV2GeminiLoading || autoV2Generating}
                                                onClick={async () => {
                                                    if (!autoV2LastRun || !autoV2Coverage) return;
                                                    const out = await runAutoV2PlanningAgentGemini(
                                                        autoV2LastRun.assignments,
                                                        autoV2Coverage,
                                                        autoV2LastRun.ctx,
                                                        autoV2LastRun.stats,
                                                        { ...pendingChanges },
                                                        true,
                                                    );
                                                    setPendingChanges({ ...out.changes });
                                                    setAutoV2Coverage(out.coverage);
                                                    setAutoV2LastRun({ ...autoV2LastRun, assignments: out.assignments });
                                                    setAutoV2Suggestions(
                                                        buildScheduleOptimizationSuggestions(
                                                            autoV2LastRun.ctx,
                                                            out.assignments,
                                                            autoV2LastRun.stats,
                                                        ),
                                                    );
                                                }}
                                                className="w-full py-2 rounded-lg text-[11px] font-black text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                                                {autoV2GeminiLoading ? 'IA trabajando…' : '↻ Re-ejecutar ajuste fino IA'}
                                            </button>
                                        )}

                                        {/* Autorización 200h */}
                                        {capOverflowEmps.length > 0 && (
                                            <div className="rounded-xl border-2 border-orange-300 bg-orange-50 p-3">
                                                <p className="text-[11px] font-black text-orange-800 mb-1">
                                                    ⚠ {capOverflowEmps.length} empleado{capOverflowEmps.length > 1 ? 's' : ''} alcanzaron el tope de 200h
                                                </p>
                                                <p className="text-[10px] text-orange-700 font-bold mb-2">
                                                    Autorizá quiénes pueden superarlo con PIN de supervisor. El motor re-generará.
                                                </p>
                                                <div className="space-y-1 mb-3">
                                                    {capOverflowEmps.map(e => (
                                                        <label key={e.empId} className="flex items-center gap-2 cursor-pointer">
                                                            <input type="checkbox"
                                                                checked={over200AuthChecked[e.empId] ?? false}
                                                                onChange={ev => setOver200AuthChecked(prev => ({ ...prev, [e.empId]: ev.target.checked }))}
                                                                className="w-3.5 h-3.5 accent-orange-600"/>
                                                            <span className="text-[11px] font-bold text-slate-800">{e.nombre}</span>
                                                            {authorizedOver200Ids.has(e.empId) && (
                                                                <span className="text-[9px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">ya autorizado</span>
                                                            )}
                                                        </label>
                                                    ))}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <SupervisorPinInput
                                                        value={over200AuthPin}
                                                        onChange={e => { setOver200AuthPin(e.target.value.replace(/\D/g, '').slice(0, 20)); setOver200AuthError(''); }}
                                                        placeholder="PIN supervisor (mín. 4 dígitos)"
                                                        maxLength={20}
                                                        className="flex-1 min-w-0 rounded-lg border border-orange-300 px-2 py-1.5 text-[11px] font-bold bg-white outline-none focus:ring-2 focus:ring-orange-400"/>
                                                    <button type="button"
                                                        disabled={autoV2Generating || !over200AuthPin}
                                                        onClick={() => {
                                                            if (over200AuthPin.length < 4) { setOver200AuthError('PIN mínimo 4 caracteres'); return; }
                                                            const toAuthorize = capOverflowEmps.filter(e => over200AuthChecked[e.empId]).map(e => e.empId);
                                                            if (toAuthorize.length === 0) { setOver200AuthError('Seleccioná al menos un empleado'); return; }
                                                            const next = new Set(authorizedOver200IdsRef.current);
                                                            toAuthorize.forEach(id => next.add(id));
                                                            authorizedOver200IdsRef.current = next;
                                                            setAuthorizedOver200Ids(next);
                                                            setCapOverflowEmps([]);
                                                            setOver200AuthPin(''); setOver200AuthError('');
                                                            applyAutoScheduleV2();
                                                        }}
                                                        className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-black text-white bg-orange-600 hover:bg-orange-700 transition-colors disabled:opacity-50">
                                                        Autorizar y re-generar
                                                    </button>
                                                </div>
                                                {over200AuthError && <p className="text-[10px] font-bold text-rose-700 mt-1">{over200AuthError}</p>}
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* Ajustar configuración — colapsible, visible en verified (no viable) y done */}
                                {(autoWizardStep === 'verified' || autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && (
                                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                                        <button type="button"
                                            onClick={() => setAutoWizardPersonalize(p => !p)}
                                            className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-black text-slate-600 bg-slate-50 hover:bg-slate-100 transition-colors">
                                            <span>Ajustar configuración</span>
                                            {autoWizardPersonalize ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
                                        </button>
                                        {autoWizardPersonalize && (
                                            <div className="px-3 pb-3 pt-2 bg-white space-y-3">
                                                {autoCycles.length > 0 && (
                                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                                                        <p className="text-[9px] font-black text-slate-500 uppercase">Esquema (automático)</p>
                                                        <p className="text-[11px] font-black text-slate-800">{autoCycles.join(' · ')}</p>
                                                    </div>
                                                )}
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <button type="button" onClick={() => setAutoV2BudgetMode('cct')}
                                                        className={`py-1.5 rounded-lg text-[10px] font-black border-2 transition-colors text-left px-2 ${autoV2BudgetMode==='cct' ? 'border-amber-500 bg-amber-100 text-amber-700' : 'border-slate-200 text-slate-500'}`}>
                                                        CCT por tramos<div className={`text-[9px] font-bold ${autoV2BudgetMode==='cct' ? 'opacity-80' : 'opacity-50'}`}>cola + nuevo desde día {autoV2Report?.metrics.cctCutoffDay ?? 25}</div>
                                                    </button>
                                                    <button type="button" onClick={() => setAutoV2BudgetMode('calendar')}
                                                        className={`py-1.5 rounded-lg text-[10px] font-black border-2 transition-colors text-left px-2 ${autoV2BudgetMode==='calendar' ? 'border-amber-500 bg-amber-100 text-amber-700' : 'border-slate-200 text-slate-500'}`}>
                                                        Calendario simple<div className={`text-[9px] font-bold ${autoV2BudgetMode==='calendar' ? 'opacity-80' : 'opacity-50'}`}>200h netas sin cola</div>
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-black text-slate-700 flex-1">Sobreescribir celdas ya asignadas</span>
                                                    <button type="button" onClick={() => setAutoOverwrite(p => !p)}
                                                        className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${autoOverwrite ? 'bg-amber-500' : 'bg-slate-300'}`}>
                                                        <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm ${autoOverwrite ? 'translate-x-4' : ''}`}/>
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-black text-slate-700 flex-1">Ajuste fino IA tras generar (Gemini)</span>
                                                    <button type="button" onClick={() => setAutoV2RunGemini(p => !p)}
                                                        className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${autoV2RunGemini ? 'bg-indigo-500' : 'bg-slate-300'}`}>
                                                        <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm ${autoV2RunGemini ? 'translate-x-4' : ''}`}/>
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-black text-slate-700 flex-1">Cobertura de ausencias (V/L/E/A/PG)</span>
                                                    <button type="button" onClick={() => setAutoCoverAbsences(p => !p)}
                                                        className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${autoCoverAbsences ? 'bg-teal-500' : 'bg-slate-300'}`}>
                                                        <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm ${autoCoverAbsences ? 'translate-x-4' : ''}`}/>
                                                    </button>
                                                </div>
                                                {/* Ausencias — mini wizard */}
                                                {autoV2CoveragePreflight && autoV2CoveragePreflight.employees.some(e => e.blockedCount > 0) && (
                                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 space-y-1.5">
                                                        <p className="text-[9px] font-black uppercase tracking-wide text-amber-700 mb-1">Ausencias en el mes</p>
                                                        {autoV2CoveragePreflight.employees.filter(e => e.blockedCount > 0).map(emp => {
                                                            const absMap = autoAbsencesMap[emp.empId];
                                                            const codes = absMap
                                                                ? [...new Set([...absMap.values()].filter(c => ['V','L','E','A','PG','AA'].includes(c)))]
                                                                : [];
                                                            return (
                                                                <div key={emp.empId} className="flex items-center justify-between gap-1.5">
                                                                    <div className="min-w-0">
                                                                        <span className="text-[10px] font-black text-amber-800 truncate block">{emp.nombre}</span>
                                                                        <span className="text-[9px] font-bold text-amber-600">{emp.blockedCount}d{codes.length > 0 ? ` · ${codes.join('/')}` : ''}</span>
                                                                    </div>
                                                                    <span className="shrink-0 text-[9px] font-black px-2 py-1 rounded-lg border border-violet-200 bg-violet-50 text-violet-600">
                                                                        D12 auto
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                <button type="button"
                                                    onClick={() => { setAutoWizardPersonalize(false); runFullGeneration(); }}
                                                    disabled={autoV2Loading || autoV2Generating}
                                                    className="w-full py-2 rounded-lg text-[11px] font-black text-white bg-amber-500 hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                                                    <RefreshCw size={11}/> Re-generar (re-evalúa esquema)
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                            </div>

                            {/* Footer */}
                            <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-5 py-3 flex flex-col gap-2 rounded-b-2xl">
                                {slaDebug && (
                                    <div className="bg-slate-900 text-slate-100 text-[10px] rounded-lg p-2 max-h-60 overflow-y-auto">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="font-black text-emerald-300">doc id: {slaDebug.id}</span>
                                            <div className="flex gap-2">
                                                <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(slaDebug, null, 2)); toast.success('JSON copiado'); }} className="text-[10px] font-bold text-slate-300 hover:text-white">copiar</button>
                                                <button onClick={() => setSlaDebug(null)} className="text-[10px] font-bold text-slate-300 hover:text-white">cerrar</button>
                                            </div>
                                        </div>
                                        <pre className="whitespace-pre-wrap break-all leading-tight">{JSON.stringify(slaDebug.data, null, 2)}</pre>
                                    </div>
                                )}
                                <div className="flex items-center justify-between gap-3">
                                    <button type="button" onClick={fetchSlaDebug} disabled={slaDebugLoading || !selectedObjective}
                                        className="text-[11px] font-black text-slate-400 hover:text-slate-700 disabled:opacity-40 transition-colors">
                                        {slaDebugLoading ? 'Cargando…' : '🔧 SLA JSON'}
                                    </button>
                                    <div className="flex items-center gap-2">
                                        {autoWizardStep === 'configure' && !autoV2Loading && !autoV2Generating && (
                                            <button type="button"
                                                onClick={() => runFullGeneration()}
                                                className="px-5 py-2 rounded-xl text-sm font-black text-white bg-amber-500 hover:bg-amber-600 transition-colors flex items-center gap-1.5">
                                                <Wand2 size={14}/> Generar
                                            </button>
                                        )}
                                        {autoWizardStep === 'sla_open' && !autoV2Loading && !autoV2Generating && (
                                            <>
                                                <button type="button"
                                                    onClick={() => setShowAutoV2Modal(false)}
                                                    className="px-5 py-2 rounded-xl text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">
                                                    Ver grilla
                                                </button>
                                                <button type="button"
                                                    onClick={() => runFullGeneration()}
                                                    className="px-5 py-2 rounded-xl text-sm font-black text-white bg-rose-600 hover:bg-rose-700 transition-colors flex items-center gap-1.5">
                                                    <RefreshCw size={14}/> Re-generar
                                                </button>
                                            </>
                                        )}
                                        <button type="button"
                                            onClick={() => {
                                                if (autoV2GeminiLoading) {
                                                    setAutoV2GeminiLoading(false);
                                                    setAutoV2Progress(null);
                                                }
                                                setShowAutoV2Modal(false);
                                            }}
                                            disabled={autoV2Loading || autoV2Generating}
                                            className="px-5 py-2 rounded-xl text-sm font-black text-slate-600 bg-slate-200 hover:bg-slate-300 transition-colors disabled:opacity-50">
                                            Cerrar
                                        </button>
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>
    , document.body);
}
