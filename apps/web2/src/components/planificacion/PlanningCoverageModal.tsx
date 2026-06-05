/**
 * Modal de cobertura para el módulo de planificación.
 * Busca en toda la nómina activa y muestra disponibilidad para el día/banda solicitados.
 * Al confirmar, llama onAssign() → el padre actualiza pendingChanges (borrador, no Firestore).
 */
import React, { useState, useEffect, useMemo } from 'react';
import { X, User, Search, CheckCircle, Loader2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import type { CoverageGap } from '@/lib/planificacion/coverageEngine';

type EmpRow = {
    id: string;
    nombre: string;
    currentCode: string | null; // código en pendingChanges/shiftsMap ese día
    available: boolean;         // true = no tiene M/T/N en ese momento
};

type Props = {
    gap: (CoverageGap & { absentName?: string }) | null;
    pendingChanges: Record<string, any>;
    shiftsMap: Record<string, any>;
    empresaId: string;
    positionName: string;
    onAssign: (empId: string, nombre: string) => void;
    onClose: () => void;
};

const BAND_ORDER = ['sin_turno', 'RET', 'ESC', 'F', 'FF', 'M', 'T', 'N', 'D12', 'N12'];
const BUSY_CODES = new Set(['M', 'T', 'N', 'D12', 'N12']);

function codeBadge(code: string | null) {
    if (!code) return <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">LIBRE</span>;
    const colors: Record<string, string> = {
        F: 'bg-green-100 text-green-800', FF: 'bg-green-100 text-green-800',
        RET: 'bg-violet-100 text-violet-800', ESC: 'bg-blue-100 text-blue-800',
        M: 'bg-amber-100 text-amber-800', T: 'bg-orange-100 text-orange-800',
        N: 'bg-indigo-100 text-indigo-800', D12: 'bg-rose-100 text-rose-800', N12: 'bg-rose-100 text-rose-800',
    };
    return <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${colors[code] ?? 'bg-slate-100 text-slate-600'}`}>{code}</span>;
}

export default function PlanningCoverageModal({ gap, pendingChanges, shiftsMap, empresaId, positionName, onAssign, onClose }: Props) {
    const [employees, setEmployees] = useState<EmpRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<EmpRow | null>(null);
    const [phase, setPhase] = useState<'list' | 'confirm'>('list');

    useEffect(() => {
        if (!gap) return;
        setSearch(''); setSelected(null); setPhase('list');
        loadEmployees(gap.dateStr);
    }, [gap?.absentEmpId, gap?.dateStr]);

    const loadEmployees = async (dateStr: string) => {
        setLoading(true);
        try {
            const q = query(
                collection(db, 'empleados'),
                where('status', 'in', ['activo', 'active', 'ACTIVO']),
                limit(200),
            );
            const snap = await getDocs(q);
            const rows: EmpRow[] = snap.docs
                .filter(d => d.id !== gap?.absentEmpId)
                .map(d => {
                    const data = d.data() as any;
                    const nombre = [data.apellido || data.lastName, data.nombre || data.firstName].filter(Boolean).join(', ')
                        || data.nombre || data.name || d.id;
                    const key = `${d.id}_${dateStr}`;
                    const asig = pendingChanges[key] ?? shiftsMap[key];
                    const code = asig?.code ?? null;
                    return { id: d.id, nombre, currentCode: code, available: !BUSY_CODES.has(code ?? '') };
                });

            // Orden: disponibles primero, luego por prioridad de código
            rows.sort((a, b) => {
                if (a.available !== b.available) return a.available ? -1 : 1;
                const ai = BAND_ORDER.indexOf(a.currentCode ?? 'sin_turno');
                const bi = BAND_ORDER.indexOf(b.currentCode ?? 'sin_turno');
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
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
        if (!s) return employees;
        return employees.filter(e => e.nombre.toLowerCase().includes(s));
    }, [employees, search]);

    const handleConfirm = () => {
        if (!selected) return;
        onAssign(selected.id, selected.nombre);
        onClose();
    };

    if (!gap) return null;

    return (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                    <div>
                        <p className="text-[11px] font-black text-slate-800 uppercase tracking-wide">Asignar cobertura</p>
                        <p className="text-[10px] font-bold text-slate-500">
                            {gap.absentName?.split(',')[0]} · día {gap.dateStr.slice(8,10)} · banda {gap.band}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                        <X size={16}/>
                    </button>
                </div>

                {phase === 'list' && (
                    <>
                        {/* Buscador */}
                        <div className="px-4 py-2 border-b border-slate-100">
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

                        {/* Lista */}
                        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
                            {loading && (
                                <div className="flex justify-center py-8">
                                    <Loader2 size={20} className="animate-spin text-slate-400"/>
                                </div>
                            )}
                            {!loading && filtered.length === 0 && (
                                <p className="text-center text-[11px] text-slate-400 py-8">Sin resultados</p>
                            )}
                            {!loading && filtered.map(emp => (
                                <button
                                    key={emp.id}
                                    type="button"
                                    onClick={() => { setSelected(emp); setPhase('confirm'); }}
                                    className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-colors ${
                                        emp.available
                                            ? 'border-slate-200 hover:border-teal-300 hover:bg-teal-50'
                                            : 'border-slate-100 bg-slate-50 hover:border-slate-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <div className={`p-1.5 rounded-lg shrink-0 ${emp.available ? 'bg-teal-100' : 'bg-slate-100'}`}>
                                            <User size={13} className={emp.available ? 'text-teal-700' : 'text-slate-400'}/>
                                        </div>
                                        <span className={`text-[11px] font-black truncate ${emp.available ? 'text-slate-800' : 'text-slate-400'}`}>
                                            {emp.nombre}
                                        </span>
                                    </div>
                                    <div className="shrink-0">
                                        {codeBadge(emp.currentCode)}
                                    </div>
                                </button>
                            ))}
                        </div>

                        <div className="px-4 py-2 border-t border-slate-100 text-[9px] font-bold text-slate-400">
                            {filtered.length} empleado(s) · verde = disponible · código = turno ese día
                        </div>
                    </>
                )}

                {phase === 'confirm' && selected && (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-5">
                        <CheckCircle size={40} className="text-teal-500"/>
                        <div className="text-center space-y-1">
                            <p className="text-base font-black text-slate-800">{selected.nombre}</p>
                            <p className="text-[11px] font-bold text-slate-500">
                                cubre a {gap.absentName?.split(',')[0]} el día {gap.dateStr.slice(8,10)} banda {gap.band}
                            </p>
                            {selected.currentCode && BUSY_CODES.has(selected.currentCode) && (
                                <p className="text-[10px] font-bold text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg mt-2">
                                    ⚠ Actualmente tiene {selected.currentCode} ese día — verificá conflicto de horario
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
