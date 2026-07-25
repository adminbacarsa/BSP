import React, { useMemo, useState } from 'react';
import {
    AlertTriangle,
    Building2,
    Loader2,
    RefreshCw,
    Search,
    Target,
} from 'lucide-react';
import { toast } from 'sonner';
import { useEmpresa } from '@/context/EmpresaContext';
import { useObjectivePlanningCatalog } from '@/hooks/useObjectivePlanningCatalog';
import {
    AUTO_LAB_REAL_CASE_ID,
    loadAutoLabRealServiceBundle,
    type AutoLabRealServiceBundle,
} from '@/lib/planificacion/autoLabRealService';
import { formatPositionActiveDaysLabel } from '@/lib/slaPlanningMatch';

function RealPositionDiagram({ positions }: { positions: AutoLabRealServiceBundle['caseDef']['positions'] }) {
    return (
        <div className="space-y-3">
            {positions.map((pos) => {
                const bands = (pos.shifts || []).map((s) => s.code).join(' · ') || '—';
                const days = formatPositionActiveDaysLabel(pos.activeDays);
                return (
                    <div
                        key={pos.positionName}
                        className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm"
                    >
                        <div className="flex items-start justify-between gap-2">
                            <p className="font-black text-slate-800 text-sm">{pos.positionName}</p>
                            <span className="text-[10px] font-black uppercase tracking-wide bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                                ×{Math.max(1, Number(pos.qty) || 1)}
                            </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <span className="rounded-lg bg-white border border-emerald-200 px-2 py-1 font-mono text-indigo-800">
                                {bands}
                            </span>
                            <span className="rounded-lg bg-white border border-emerald-200 px-2 py-1 text-slate-600">
                                {String(pos.coverageType || 'custom')}
                            </span>
                            <span className="rounded-lg bg-white border border-emerald-200 px-2 py-1 text-slate-600">
                                {days}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export interface AutoLabRealServicePanelProps {
    year: number;
    month: number;
    bundle: AutoLabRealServiceBundle | null;
    loading: boolean;
    onBundleChange: (bundle: AutoLabRealServiceBundle | null) => void;
    onLoadingChange: (loading: boolean) => void;
}

export default function AutoLabRealServicePanel({
    year,
    month,
    bundle,
    loading,
    onBundleChange,
    onLoadingChange,
}: AutoLabRealServicePanelProps) {
    const { empresaId, empresa } = useEmpresa();
    const { objectives, clients, getSlasForObjective, loading: loadingCatalog } =
        useObjectivePlanningCatalog(empresaId);
    const [search, setSearch] = useState('');
    const [selectedKey, setSelectedKey] = useState('');

    const filteredObjectives = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return objectives;
        return objectives.filter((o) =>
            `${o.clientName} ${o.objectiveName} ${o.objectiveId}`.toLowerCase().includes(q),
        );
    }, [objectives, search]);

    const selectedObjective = useMemo(() => {
        if (!selectedKey) return null;
        return objectives.find((o) => `${o.clientId}::${o.objectiveId}` === selectedKey) ?? null;
    }, [objectives, selectedKey]);

    const loadService = async (obj = selectedObjective) => {
        if (!obj || !empresaId) {
            toast.error('Seleccioná un objetivo');
            return;
        }
        const slas = getSlasForObjective(obj.clientId, obj.objectiveId);
        if (slas.length === 0) {
            toast.error('Sin SLA en Servicios para este objetivo');
            return;
        }
        onLoadingChange(true);
        onBundleChange(null);
        try {
            const loaded = await loadAutoLabRealServiceBundle({
                empresaId,
                objective: obj,
                year,
                month,
                slas,
                clients,
                migracionCompleta: empresa?.migracionCompleta === true,
            });
            onBundleChange(loaded);
            toast.success(
                `${loaded.employees.length} guardias · ${loaded.caseDef.positions.length} puesto(s) — motor listo`,
            );
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Error al cargar servicio real');
        } finally {
            onLoadingChange(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4">
                <p className="text-xs font-black uppercase text-emerald-900 mb-1">Servicio real</p>
                <p className="text-sm text-emerald-950">
                    Elegí un objetivo de la plataforma. El motor genera la grilla igual que en casos 1–5
                    (cerebro + cobertura + panel de resolución). <strong>No escribe en Firestore.</strong>
                </p>
            </div>

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

            <div className="rounded-2xl border border-slate-200 bg-white max-h-48 overflow-y-auto shadow-sm">
                {loadingCatalog ? (
                    <p className="p-4 text-xs text-slate-500 flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        Cargando objetivos…
                    </p>
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {filteredObjectives.map((obj) => {
                            const key = `${obj.clientId}::${obj.objectiveId}`;
                            const slaCount = getSlasForObjective(obj.clientId, obj.objectiveId).length;
                            return (
                                <li key={key}>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedKey(key)}
                                        className={`w-full text-left px-3 py-2.5 ${
                                            selectedKey === key
                                                ? 'bg-emerald-50 border-l-4 border-emerald-600'
                                                : 'hover:bg-slate-50 border-l-4 border-transparent'
                                        }`}
                                    >
                                        <p className="text-xs font-black text-slate-800">{obj.objectiveName}</p>
                                        <p className="text-[10px] text-slate-500 flex items-center gap-1">
                                            <Building2 size={10} />
                                            {obj.clientName}
                                            {slaCount > 0 ? ` · ${slaCount} SLA` : ' · sin SLA'}
                                        </p>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <button
                type="button"
                disabled={!selectedObjective || loading}
                onClick={() => void loadService()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2.5 text-sm font-black shadow-sm"
            >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                Cargar y resolver servicio
            </button>

            {bundle && (
                <div className="space-y-3">
                    <div className="flex items-start gap-2">
                        <Target size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-black text-slate-800">{bundle.objectiveName}</p>
                            <p className="text-xs text-slate-600">{bundle.clientName}</p>
                            <p className="text-[10px] text-slate-400 font-mono">{bundle.objectiveId}</p>
                            <p className="text-[11px] text-emerald-800 mt-1">SLA: {bundle.slaLabel}</p>
                        </div>
                    </div>

                    <RealPositionDiagram positions={bundle.caseDef.positions} />

                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="font-black uppercase text-slate-500 text-[10px]">Guardias</p>
                            <p className="font-bold text-slate-800 mt-1">{bundle.employees.length}</p>
                            <p className="text-[10px] text-slate-500">{bundle.employeeSource}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="font-black uppercase text-slate-500 text-[10px]">Ausencias RRHH</p>
                            <p className="font-bold text-slate-800 mt-1">{bundle.absencesRrhh.length}</p>
                        </div>
                    </div>

                    {bundle.warnings.length > 0 && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
                            {bundle.warnings.map((w) => (
                                <p key={w} className="text-xs text-amber-950 flex gap-2">
                                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                                    {w}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export { AUTO_LAB_REAL_CASE_ID };
