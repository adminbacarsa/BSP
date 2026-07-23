import React, { useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { AUTO_LAB_CASES, type AutoLabCaseDefinition } from '@/lib/planificacion/autoLabCaseCatalog';
import {
    buildAutoLabExportJson,
    runAutoLabCase,
    type AutoLabRunResult,
} from '@/lib/planificacion/autoLabRuntime';
import {
    AlertTriangle,
    ArrowLeft,
    Brain,
    CheckCircle2,
    Copy,
    FlaskConical,
    Layers,
    RotateCw,
    Users,
    XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { canAccessAutoLab } from '@/lib/planificacion/autoLabAccess';

const IS_EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';

const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function rotationLabel(mode: AutoLabCaseDefinition['rotationMode']): string {
    if (mode === 'fixed') return 'Banda fija';
    if (mode === 'rotative') return 'Rotativo M→T→N';
    return 'Auto (cerebro decide)';
}

function PositionDiagram({ positions }: { positions: AutoLabCaseDefinition['positions'] }) {
    return (
        <div className="space-y-3">
            {positions.map((pos) => {
                const bands = (pos.shifts || []).map((s) => s.code).join(' · ') || '—';
                const days = pos.activeDays?.length && pos.activeDays.length < 7
                    ? pos.activeDays.join(' ')
                    : 'L–D';
                return (
                    <div
                        key={pos.positionName}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm"
                    >
                        <div className="flex items-start justify-between gap-2">
                            <p className="font-black text-slate-800 text-sm">{pos.positionName}</p>
                            <span className="text-[10px] font-black uppercase tracking-wide bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full">
                                ×{Math.max(1, Number(pos.qty) || 1)}
                            </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <span className="rounded-lg bg-white border border-slate-200 px-2 py-1 font-mono text-indigo-800">
                                {bands}
                            </span>
                            <span className="rounded-lg bg-white border border-slate-200 px-2 py-1 text-slate-600">
                                {String(pos.coverageType || 'custom')}
                            </span>
                            <span className="rounded-lg bg-white border border-slate-200 px-2 py-1 text-slate-600">
                                {days}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
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

export default function AutoLabPage() {
    const { isSuperAdmin, canReadModule, rolePermissions } = useAuth();
    const now = new Date();
    const [selectedId, setSelectedId] = useState(AUTO_LAB_CASES[0]?.id ?? '');
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth() + 1);

    const canPlan = canReadModule('PLANNING');
    const canAccess = canAccessAutoLab(isSuperAdmin, rolePermissions);

    const selectedCase = useMemo(
        () => AUTO_LAB_CASES.find((c) => c.id === selectedId) ?? AUTO_LAB_CASES[0],
        [selectedId],
    );

    const runResult: AutoLabRunResult | null = useMemo(() => {
        if (!selectedCase) return null;
        try {
            return runAutoLabCase(selectedCase, year, month);
        } catch {
            return null;
        }
    }, [selectedCase, year, month]);

    const handleCopyJson = async () => {
        if (!runResult || !selectedCase) return;
        const payload = buildAutoLabExportJson(runResult, selectedCase);
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
                        Un administrador puede activarlo en Configuración → Roles.
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
                                <h1 className="text-2xl font-black tracking-tight">Auto Lab</h1>
                                <p className="text-sm text-indigo-100 mt-1 max-w-2xl">
                                    Catálogo de casos de menor a mayor complejidad. Corre el cerebro real
                                    (<code className="bg-white/10 px-1 rounded">resolveAutoPlanningBrain</code>) sin
                                    Firestore ni publicar cronogramas.
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
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Período</label>
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
                                    const active = c.id === selectedCase?.id;
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
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-5 space-y-4">
                        {selectedCase && (
                            <>
                                <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
                                    <div className="flex items-start gap-3 mb-4">
                                        <div className="rounded-xl bg-indigo-100 p-2">
                                            <Layers size={18} className="text-indigo-700" />
                                        </div>
                                        <div>
                                            <h2 className="font-black text-slate-800">{selectedCase.title}</h2>
                                            <p className="text-sm text-slate-600 mt-1">{selectedCase.description}</p>
                                        </div>
                                    </div>

                                    <PositionDiagram positions={selectedCase.positions} />

                                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">Ciclo</p>
                                            <p className="font-bold text-slate-800 mt-1">{selectedCase.cycle}</p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">Rotación</p>
                                            <p className="font-bold text-slate-800 mt-1 flex items-center gap-1">
                                                <RotateCw size={12} className="text-indigo-600" />
                                                {rotationLabel(selectedCase.rotationMode)}
                                            </p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">Dotación</p>
                                            <p className="font-bold text-slate-800 mt-1 flex items-center gap-1">
                                                <Users size={12} className="text-emerald-600" />
                                                {selectedCase.employeeCount} guardias sintéticos
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

                                <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5 space-y-3">
                                    <p className="text-xs font-black uppercase text-slate-600">Qué esperar</p>
                                    <ul className="space-y-2">
                                        {selectedCase.expectations.map((exp) => (
                                            <li key={exp} className="text-sm text-slate-700 flex gap-2">
                                                <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                                                {exp}
                                            </li>
                                        ))}
                                    </ul>
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                                        <strong>Cobertura:</strong> {selectedCase.coverageNotes}
                                    </div>
                                </div>
                            </>
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
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
                                            <p className="font-black uppercase text-indigo-700 text-[10px]">Ciclo elegido</p>
                                            <p className="font-black text-indigo-900 text-lg mt-1">{brain.pickedCycle}</p>
                                        </div>
                                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                                            <p className="font-black uppercase text-emerald-700 text-[10px]">Plantilla</p>
                                            <p className="font-black text-emerald-900 text-lg mt-1">{staffing.plantillaTotal}</p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">Servicio/día (8h)</p>
                                            <p className="font-bold text-slate-800 mt-1">{staffing.servicioDiarioModo8}</p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <p className="font-black uppercase text-slate-500 text-[10px]">Pool francos</p>
                                            <p className="font-bold text-slate-800 mt-1">{staffing.poolFrancos}</p>
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
                                            <span className="font-bold text-slate-700">Sugerido con ciclo:</span>{' '}
                                            {feasibility.metrics.peopleSuggestedWithCycle} guardias
                                        </p>
                                    </div>

                                    {brain.modo12DaysAuto.length > 0 && (
                                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                                            <strong>Modo 12 auto:</strong> {brain.modo12DaysAuto.join(', ')}
                                        </div>
                                    )}

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
                                </div>
                            ) : (
                                <div className="p-8 text-center text-sm text-slate-500">
                                    No se pudo calcular el cerebro para este caso.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
