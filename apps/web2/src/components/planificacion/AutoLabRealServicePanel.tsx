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
    type AutoLabSlaOptionalFeatureState,
} from '@/lib/planificacion/autoLabRealService';
import AutoLabPositionDiagram from '@/components/planificacion/AutoLabPositionDiagram';

function RealPositionDiagram({
    positions,
    year,
    month,
    serviceStart,
    serviceEnd,
    excludedDates,
}: {
    positions: AutoLabRealServiceBundle['caseDef']['positions'];
    year: number;
    month: number;
    serviceStart?: string;
    serviceEnd?: string;
    excludedDates?: string[];
}) {
    const slaContext = serviceStart && serviceEnd
        ? { year, month, serviceStart, serviceEnd, excludedDates }
        : undefined;
    return (
        <AutoLabPositionDiagram
            positions={positions}
            variant="real"
            slaContext={slaContext}
        />
    );
}

function slaFeatureBadgeClass(state: AutoLabSlaOptionalFeatureState): string {
    if (state === 'active') return 'bg-indigo-50 text-indigo-900 border-indigo-200';
    if (state === 'on_empty') return 'bg-amber-50 text-amber-950 border-amber-200';
    return 'bg-slate-100 text-slate-600 border-slate-200';
}

function slaFeatureLabel(state: AutoLabSlaOptionalFeatureState): string {
    if (state === 'active') return 'Activa';
    if (state === 'on_empty') return 'Sin datos';
    return 'Off';
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
    const { objectives, clients, getSlasForObjective, loading: loadingCatalog, slas, objectivesWithSla, tenantClientCount } =
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
                {!loadingCatalog && empresaId && (
                    <p className="text-[10px] text-emerald-800/90 mt-2 font-bold">
                        Empresa <span className="font-mono">{empresaId}</span>
                        {' · '}
                        {objectives.length} objetivo(s)
                        {' · '}
                        {slas.length} SLA del tenant
                        {' · '}
                        {objectivesWithSla} con contrato vinculado
                    </p>
                )}
            </div>

            {!loadingCatalog && objectives.length > 0 && slas.length > 0 && objectivesWithSla === 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                    Hay {slas.length} SLA en el tenant pero ninguno coincide con cliente/objetivo del CRM.
                    Revisá que el SLA tenga el mismo <span className="font-mono">clientId</span> y{' '}
                    <span className="font-mono">objectiveId</span> que el objetivo en Servicios/CRM.
                </div>
            )}

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
                ) : filteredObjectives.length === 0 ? (
                    <p className="p-4 text-xs text-slate-500 space-y-1">
                        <span className="block">
                            Sin objetivos para Auto Lab en <span className="font-mono">{empresaId}</span>.
                        </span>
                        <span className="block text-slate-400">
                            Clientes del tenant: {tenantClientCount} · SLA visibles: {slas.length}
                        </span>
                        {slas.length > 0 ? (
                            <span className="block text-amber-800">
                                Hay SLA pero falta vincularlos: revisá <span className="font-mono">clientId</span> y{' '}
                                <span className="font-mono">objectiveId</span> en Servicios, o agregá objetivos en CRM.
                            </span>
                        ) : (
                            <span className="block">
                                Sin clientes con <span className="font-mono">empresaId</span> de esta empresa ni SLA del
                                tenant. En emulador: <span className="font-mono">node scripts/seed-empresa-prueba.js</span>
                            </span>
                        )}
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
                                            {obj.fromSlaOnly ? ' · ref. SLA' : ''}
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
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                <span
                                    className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${slaFeatureBadgeClass(bundle.slaContract.coberturaDotacion)}`}
                                    title="Quién puede cubrir qué puesto/banda"
                                >
                                    Cobertura · {slaFeatureLabel(bundle.slaContract.coberturaDotacion)}
                                    {bundle.slaContract.coberturaGuardiasConfigurados > 0
                                        ? ` (${bundle.slaContract.coberturaGuardiasConfigurados})`
                                        : ''}
                                </span>
                                <span
                                    className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${slaFeatureBadgeClass(bundle.slaContract.condiciones)}`}
                                >
                                    Condiciones · {slaFeatureLabel(bundle.slaContract.condiciones)}
                                    {bundle.slaContract.condicionesCount > 0
                                        ? ` (${bundle.slaContract.condicionesCount})`
                                        : ''}
                                </span>
                                <span
                                    className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${slaFeatureBadgeClass(bundle.slaContract.rotaciones)}`}
                                >
                                    Rotaciones · {slaFeatureLabel(bundle.slaContract.rotaciones)}
                                    {bundle.slaContract.rotacionesCount > 0
                                        ? ` (${bundle.slaContract.rotacionesCount})`
                                        : ''}
                                </span>
                            </div>
                        </div>
                    </div>

                    <RealPositionDiagram
                        positions={bundle.caseDef.positions}
                        year={year}
                        month={month}
                        serviceStart={bundle.caseDef.serviceStartDate}
                        serviceEnd={bundle.caseDef.serviceEndDate}
                        excludedDates={bundle.caseDef.excludedDates}
                    />

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
