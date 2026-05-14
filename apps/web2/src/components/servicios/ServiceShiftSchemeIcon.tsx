'use client';

import React from 'react';
import { LayoutGrid } from 'lucide-react';

export interface ServiceShiftSchemeIconProps {
    onOpen: () => void;
    hasIssues?: boolean;
    /** 1–10: complejidad para cubrir el servicio (0 = no mostrar). */
    complexityScore?: number;
}

export function ServiceShiftSchemeIcon({ onOpen, hasIssues, complexityScore }: ServiceShiftSchemeIconProps) {
    const s = typeof complexityScore === 'number' ? complexityScore : 0;
    const showCx = s > 0;
    const cxClass =
        s <= 3
            ? 'text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-950/60'
            : s <= 6
              ? 'text-amber-800 bg-amber-100 dark:text-amber-200 dark:bg-amber-950/50'
              : 'text-rose-800 bg-rose-100 dark:text-rose-200 dark:bg-rose-950/50';

    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onOpen();
            }}
            title={showCx ? `Turnos y esquema — complejidad cubrir: ${s}/10` : 'Analizar turnos y esquema (6×2 / 6×1 / 4×2)'}
            className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-1 ring-1 font-black text-[8px] uppercase shrink-0 transition hover:opacity-90 ${
                hasIssues
                    ? 'ring-amber-500/50 text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300'
                    : 'ring-indigo-400/50 text-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-300'
            }`}
        >
            <LayoutGrid size={12} strokeWidth={2.5} />
            <span className="hidden sm:inline">Turnos</span>
            {showCx && (
                <span
                    className={`tabular-nums min-w-[1.1rem] text-center rounded px-0.5 text-[9px] font-black leading-none py-0.5 ${cxClass}`}
                    aria-hidden
                >
                    {s}
                </span>
            )}
        </button>
    );
}
