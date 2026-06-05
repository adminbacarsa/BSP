/**
 * Modal de cobertura para planificación.
 * - Recibe N días seleccionados (multi-asignación en un paso)
 * - Excluye empleados del mismo objetivo (ya cubiertos por D12)
 * - Agrupa candidatos por tipo: ST → RET → ESC → FT
 * - Ordena por cercanía al objetivo
 * - Opción D12 explícita (extiende horario de compañeros del objetivo)
 */
import React, { useState, useEffect, useMemo } from 'react';
import { X, User, Search, CheckCircle, Loader2, ChevronDown, ChevronRight, Clock, AlertTriangle } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import type { CoverageGap } from '@/lib/planificacion/coverageEngine';

// ─── tipos ────────────────────────────────────────────────────────────────────

type EmpRow = {
    id: string;
    nombre: string;
    currentCode: string | null;
    category: 'ST' | 'RET' | 'ESC' | 'FT' | 'OCUPADO';
    km: number | null;
};

type Props = {
    gaps: (CoverageGap & { absentName?: string })[];   // días seleccionados para cubrir
    objectiveEmpIds: Set<string>;                       // empleados del objetivo (excluir)
    objLat?: number | null;
    objLng?: number | null;
    pendingChanges: Record<string, any>;
    shiftsMap: Record<string, any>;
    empresaId: string;
    positionName: string;
    /** Cobertura externa: asignar empId a todos los gaps seleccionados */
    onAssignExternal: (empId: string, nombre: string) => void;
    /** Cobertura D12: registrar que esos días se cubren con extensión interna */
    onAssignD12: () => void;
    onClose: () => void;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const BUSY_CODES = new Set(['M', 'T', 'N', 'D12', 'N12']);
const CATEGORY_ORDER: EmpRow['category'][] = ['ST', 'RET', 'ESC', 'FT', 'OCUPADO'];
const CATEGORY_LABEL: Record<EmpRow['category'], string> = {
    ST:     'Sin turno — disponible',
    RET:    'Retención (RET)',
    ESC:    'Escuela (ESC)',
    FT:     'Franco (FT disponible)',
    OCUPADO:'Ocupado ese día',
};
const CATEGORY_COLOR: Record<EmpRow['category'], string> = {
    ST:     'text-emerald-800 bg-emerald-50 border-emerald-200',
    RET:    'text-violet-800 bg-violet-50 border-violet-200',
    ESC:    'text-blue-800 bg-blue-50 border-blue-200',
    FT:     'text-amber-800 bg-amber-50 border-amber-200',
    OCUPADO:'text-slate-500 bg-slate-50 border-slate-200',
};

function codeBadge(code: string | null) {
    const map: Record<string, string> = {
        F: 'bg-green-100 text-green-800', FF: 'bg-green-100 text-green-800',
        RET: 'bg-violet-100 text-violet-800', ESC: 'bg-blue-100 text-blue-800',
        M: 'bg-amber-100 text-amber-800', T: 'bg-orange-100 text-orange-800',
        N: 'bg-indigo-100 text-indigo-800', D12: 'bg-rose-100 text-rose-800', N12: 'bg-rose-100 text-rose-800',
    };
    if (!code) return <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">LIBRE</span>;
    return <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${map[code] ?? 'bg-slate-100 text-slate-600'}`}>{code}</span>;
}

function codeToCategory(code: string | null): EmpRow['category'] {
    if (!code) return 'ST';
    if (code === 'RET') return 'RET';
    if (code === 'ESC') return 'ESC';
    if (code === 'F' || code === 'FF') return 'FT';
    return 'OCUPADO';
}

// ─── componente ───────────────────────────────────────────────────────────────

export default function PlanningCoverageModal({
    gaps, objectiveEmpIds, objLat, objLng,
    pendingChanges, shiftsMap, empresaId, positionName,
    onAssignExternal, onAssignD12, onClose,
}: Props) {
    const [tab, setTab] = useState<'external' | 'd12'>('external');
    const [employees, setEmployees] = useState<EmpRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<EmpRow | null>(null);
    const [phase, setPhase] = useState<'list' | 'confirm'>('list');
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ OCUPADO: true });

    // Primer día representativo para consultar asignaciones
    const refDateStr = gaps[0]?.dateStr ?? '';

    useEffect(() => {
        setSearch(''); setSelected(null); setPhase('list');
        if (tab === 'external' && refDateStr) loadEmployees(refDateStr);
    }, [gaps.map(g => g.dateStr).join(','), tab]);

    const loadEmployees = async (dateStr: string) => {
        setLoading(true);
        try {
            const q = query(
                collection(db, 'empleados'),
                where('status', 'in', ['activo', 'active', 'ACTIVO']),
                limit(300),
            );
            const snap = await getDocs(q);

            const rows: EmpRow[] = [];
            for (const d of snap.docs) {
                // Excluir empleados del mismo objetivo
                if (objectiveEmpIds.has(d.id)) continue;

                const data = d.data() as any;
                if (data.empresaId && data.empresaId !== empresaId) continue;

                const nombre =
                    [data.apellido || data.lastName, data.nombre || data.firstName].filter(Boolean).join(', ')
                    || data.nombre || data.name || d.id;

                // Calcular distancia al objetivo
                const empLat = data.lat ?? data.latitude ?? null;
                const empLng = data.lng ?? data.longitude ?? null;
                const km =
                    empLat != null && empLng != null && objLat != null && objLng != null
                        ? Math.round(haversineKm(Number(empLat), Number(empLng), Number(objLat), Number(objLng)) * 10) / 10
                        : null;

                // Código ese día: buscar en TODOS los días seleccionados (tomar el más restrictivo)
                let worstCode: string | null = null;
                for (const gap of gaps) {
                    const key = `${d.id}_${gap.dateStr}`;
                    const asig = pendingChanges[key] ?? shiftsMap[key];
                    const c = asig?.code ?? null;
                    if (!worstCode && c) worstCode = c;
                    if (c && BUSY_CODES.has(c)) { worstCode = c; break; }
                }

                rows.push({ id: d.id, nombre, currentCode: worstCode, category: codeToCategory(worstCode), km });
            }

            // Orden: categoría (ST>RET>ESC>FT>OCUPADO) luego por km (nulos al final) luego nombre
            rows.sort((a, b) => {
                const ca = CATEGORY_ORDER.indexOf(a.category);
                const cb = CATEGORY_ORDER.indexOf(b.category);
                if (ca !== cb) return ca - cb;
                if (a.km != null && b.km != null) return a.km - b.km;
                if (a.km != null) return -1;
                if (b.km != null) return 1;
                return a.nombre.localeCompare(b.nombre, 'es');
            });

            setEmployees(rows);
        } catch (e: any) {
            console.error('[PlanningCoverageModal]', e);
        } finally {
            setLoading(false);
        }
    };

    const filtered = useMemo(() => {
        const s = search.trim().toLowerCase();
        return s ? employees.filter(e => e.nombre.toLowerCase().includes(s)) : employees;
    }, [employees, search]);

    // Agrupar por categoría
    const grouped = useMemo(() => {
        const g: Record<string, EmpRow[]> = {};
        for (const cat of CATEGORY_ORDER) g[cat] = [];
        for (const e of filtered) g[e.category].push(e);
        return g;
    }, [filtered]);

    const handleConfirm = () => {
        if (!selected) return;
        onAssignExternal(selected.id, selected.nombre);
        onClose();
    };

    const bandLabel = gaps[0]?.band ?? '';
    const absentName = gaps[0]?.absentName?.split(',')[0] ?? 'Ausente';
    const daysLabel = gaps.length === 1
        ? `día ${gaps[0].dateStr.slice(8, 10)}`
        : `días ${gaps.map(g => g.dateStr.slice(8, 10)).join(', ')}`;

    if (!gaps.length) return null;

    return (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl flex flex-col max-h-[88vh]">

                {/* Header */}
                <div className="flex items-start justify-between px-4 py-3 border-b border-slate-200 shrink-0">
                    <div>
                        <p className="text-[11px] font-black text-slate-800 uppercase tracking-wide">Asignar cobertura</p>
                        <p className="text-[10px] font-bold text-slate-500">
                            {absentName} · {daysLabel} · banda {bandLabel}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 shrink-0">
                        <X size={16}/>
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-200 shrink-0">
                    <button
                        onClick={() => setTab('external')}
                        className={`flex-1 py-2 text-[10px] font-black transition-colors ${tab === 'external' ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Desde nómina
                    </button>
                    <button
                        onClick={() => setTab('d12')}
                        className={`flex-1 py-2 text-[10px] font-black transition-colors ${tab === 'd12' ? 'border-b-2 border-violet-600 text-violet-700' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Turno D12
                    </button>
                </div>

                {/* ── Tab: Desde nómina ─────────────────────────────────── */}
                {tab === 'external' && phase === 'list' && (
                    <>
                        <div className="px-3 py-2 border-b border-slate-100 shrink-0">
                            <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-2.5 py-1.5">
                                <Search size={12} className="text-slate-400 shrink-0"/>
                                <input
                                    autoFocus
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    placeholder="Buscar por apellido…"
                                    className="flex-1 bg-transparent text-[11px] font-bold text-slate-700 outline-none placeholder:text-slate-400"
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
                            {loading && (
                                <div className="flex justify-center py-8">
                                    <Loader2 size={20} className="animate-spin text-slate-400"/>
                                </div>
                            )}

                            {!loading && CATEGORY_ORDER.map(cat => {
                                const items = grouped[cat] ?? [];
                                if (!items.length) return null;
                                const isCollapsed = !!collapsed[cat];
                                return (
                                    <div key={cat} className={`rounded-xl border ${CATEGORY_COLOR[cat]}`}>
                                        <button
                                            type="button"
                                            onClick={() => setCollapsed(p => ({ ...p, [cat]: !p[cat] }))}
                                            className="w-full flex items-center justify-between px-3 py-2"
                                        >
                                            <span className="text-[10px] font-black uppercase tracking-wide">
                                                {CATEGORY_LABEL[cat]}
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[9px] font-bold opacity-70">{items.length}</span>
                                                {isCollapsed ? <ChevronRight size={12}/> : <ChevronDown size={12}/>}
                                            </div>
                                        </button>
                                        {!isCollapsed && (
                                            <div className="px-2 pb-2 space-y-1 border-t border-current/10">
                                                {cat === 'FT' && (
                                                    <p className="text-[8px] font-bold text-amber-700 px-1 pt-1.5">
                                                        ⚠ FT rompe el ciclo 6+2 — confirmar con el empleado antes de asignar
                                                    </p>
                                                )}
                                                {items.map(emp => (
                                                    <button
                                                        key={emp.id}
                                                        type="button"
                                                        onClick={() => { setSelected(emp); setPhase('confirm'); }}
                                                        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/70 hover:bg-white border border-transparent hover:border-current/20 text-left transition-colors"
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <User size={13} className="shrink-0 opacity-60"/>
                                                            <span className="text-[11px] font-black truncate text-slate-800">{emp.nombre}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            {emp.km != null && (
                                                                <span className={`text-[8px] font-bold ${emp.km <= 5 ? 'text-emerald-700' : emp.km <= 15 ? 'text-amber-700' : 'text-rose-700'}`}>
                                                                    {emp.km}km
                                                                </span>
                                                            )}
                                                            {codeBadge(emp.currentCode)}
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {!loading && filtered.length === 0 && (
                                <p className="text-center text-[11px] text-slate-400 py-8">Sin personal disponible</p>
                            )}
                        </div>

                        <div className="px-4 py-2 border-t border-slate-100 shrink-0 text-[9px] font-bold text-slate-400">
                            {employees.filter(e => e.category !== 'OCUPADO').length} disponibles · ordenado por cercanía al objetivo
                        </div>
                    </>
                )}

                {/* ── Tab: D12 ─────────────────────────────────────────── */}
                {tab === 'd12' && (
                    <div className="flex-1 p-5 space-y-4 overflow-y-auto">
                        <div className="rounded-xl border-2 border-violet-200 bg-violet-50 px-4 py-3">
                            <div className="flex items-center gap-2 mb-2">
                                <Clock size={16} className="text-violet-700"/>
                                <p className="text-[11px] font-black text-violet-800">Extender turno a 12 horas</p>
                            </div>
                            <p className="text-[10px] font-bold text-violet-700 leading-relaxed mb-3">
                                Los compañeros del objetivo ya en servicio ese día extienden su turno a D12 o N12 para cubrir la banda {bandLabel}.
                                Esta opción ya está activa automáticamente via "Modo 12" del cerebro planificador.
                            </p>
                            <div className="flex items-start gap-2 text-[9px] font-bold text-violet-600 bg-white/60 rounded-lg px-3 py-2">
                                <AlertTriangle size={11} className="shrink-0 mt-0.5"/>
                                <span>Confirmar que el empleado acepta la extensión antes de guardar. Genera horas extras CCT.</span>
                            </div>
                        </div>
                        <p className="text-[10px] font-bold text-slate-600 leading-relaxed">
                            Al confirmar, los {daysLabel} quedan marcados como "D12 confirmado" en el panel de cobertura.
                        </p>
                        <button
                            type="button"
                            onClick={() => { onAssignD12(); onClose(); }}
                            className="w-full py-3 rounded-xl bg-violet-600 text-white text-[11px] font-black hover:bg-violet-700 transition-colors"
                        >
                            Confirmar D12 para {gaps.length} día(s)
                        </button>
                    </div>
                )}

                {/* ── Confirmación ─────────────────────────────────────── */}
                {tab === 'external' && phase === 'confirm' && selected && (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-5">
                        <CheckCircle size={40} className="text-teal-500"/>
                        <div className="text-center space-y-1.5">
                            <p className="text-base font-black text-slate-800">{selected.nombre}</p>
                            <p className="text-[11px] font-bold text-slate-500">
                                cubre a {absentName} · {daysLabel} · banda {bandLabel}
                            </p>
                            {selected.km != null && (
                                <p className="text-[10px] font-bold text-slate-400">{selected.km} km del objetivo</p>
                            )}
                            {selected.category === 'FT' && (
                                <p className="text-[10px] font-bold text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg">
                                    ⚠ FT: el empleado tiene franco ese día — confirmar disponibilidad
                                </p>
                            )}
                            {selected.category === 'OCUPADO' && (
                                <p className="text-[10px] font-bold text-rose-700 bg-rose-50 px-3 py-1.5 rounded-lg">
                                    ⚠ Tiene {selected.currentCode} ese día — revisar conflicto de horario
                                </p>
                            )}
                        </div>
                        <div className="flex gap-3 w-full">
                            <button
                                type="button"
                                onClick={() => setPhase('list')}
                                className="flex-1 py-2.5 rounded-xl border-2 border-slate-200 text-[11px] font-black text-slate-600 hover:bg-slate-50"
                            >
                                Volver
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirm}
                                className="flex-1 py-2.5 rounded-xl bg-teal-600 text-white text-[11px] font-black hover:bg-teal-700"
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
