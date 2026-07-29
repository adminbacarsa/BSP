import React from 'react';
import { AlertTriangle, UserMinus, Users } from 'lucide-react';
import type { RosterSurplusReport } from '@/lib/planificacion/rosterSurplus';

interface AutoLabRosterSurplusPanelProps {
    surplus: RosterSurplusReport;
    /** Tras generar crono (muestra excess por puesto e idle). */
    afterSchedule?: boolean;
}

export default function AutoLabRosterSurplusPanel({
    surplus,
    afterSchedule = false,
}: AutoLabRosterSurplusPanelProps) {
    if (!surplus.hasSurplus) return null;

    return (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 shadow-sm p-4 space-y-3">
            <div className="flex items-start gap-2">
                <AlertTriangle className="shrink-0 text-amber-600 mt-0.5" size={18} />
                <div>
                    <p className="text-sm font-black uppercase text-amber-900">
                        Dotación en exceso
                    </p>
                    <p className="text-xs text-amber-950 mt-1">
                        Hay más guardias de los que el servicio puede absorber con turnos facturables.
                        El sobrante genera RET/Franco y cronogramas confusos. Conviene sacar legajos del objetivo
                        o reasignarlos.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div className="rounded-xl bg-white/80 border border-amber-200 p-2">
                    <p className="font-black uppercase text-amber-800 text-[9px]">Reales</p>
                    <p className="font-mono font-bold text-amber-950">{surplus.sourceCount}</p>
                </div>
                <div className="rounded-xl bg-white/80 border border-amber-200 p-2">
                    <p className="font-black uppercase text-amber-800 text-[9px]">Piso (Σ qty)</p>
                    <p className="font-mono font-bold text-amber-950">{surplus.floorHeads}</p>
                </div>
                <div className="rounded-xl bg-white/80 border border-amber-200 p-2">
                    <p className="font-black uppercase text-amber-800 text-[9px]">Nec. objetivo</p>
                    <p className="font-mono font-bold text-amber-950">{surplus.peopleNeededFinal}</p>
                </div>
                <div className="rounded-xl bg-white/80 border border-amber-200 p-2">
                    <p className="font-black uppercase text-amber-800 text-[9px]">Total roster</p>
                    <p className="font-mono font-bold text-amber-950">
                        {surplus.totalCount}
                        {surplus.paddedCount > 0 && (
                            <span className="text-amber-700 font-normal"> (+{surplus.paddedCount} sint.)</span>
                        )}
                    </p>
                </div>
            </div>

            {(surplus.surplusVsFloor > 0 || surplus.surplusVsPlantilla > 0) && (
                <div className="flex flex-wrap gap-2 text-[11px]">
                    {surplus.surplusVsFloor > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-200/80 text-amber-950 px-2 py-0.5 font-bold">
                            <UserMinus size={11} />
                            +{surplus.surplusVsFloor} vs piso
                        </span>
                    )}
                    {surplus.surplusVsPlantilla > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-200/80 text-amber-950 px-2 py-0.5 font-bold">
                            <Users size={11} />
                            +{surplus.surplusVsPlantilla} vs plantilla
                        </span>
                    )}
                </div>
            )}

            {afterSchedule && surplus.retDesigneeNombre && (
                <p className="text-xs text-amber-950">
                    <span className="font-bold">RET stand-by:</span>{' '}
                    {surplus.retDesigneeNombre} (único autorizado; el resto en Franco).
                </p>
            )}

            <ul className="space-y-1.5">
                {surplus.warnings.map((w) => (
                    <li key={w} className="text-xs text-amber-950 flex gap-2 leading-snug">
                        <span className="text-amber-500 shrink-0">•</span>
                        {w}
                    </li>
                ))}
            </ul>
        </div>
    );
}
