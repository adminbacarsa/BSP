'use client';

import React from 'react';
import { LayoutGrid } from 'lucide-react';

export interface ServiceShiftSchemeIconProps {
    onOpen: () => void;
    hasIssues?: boolean;
}

export function ServiceShiftSchemeIcon({ onOpen, hasIssues }: ServiceShiftSchemeIconProps) {
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onOpen();
            }}
            title="Analizar turnos y esquema (6×2 / 6×1 / 4×2)"
            className={`inline-flex items-center gap-0.5 rounded-lg px-1.5 py-1 ring-1 font-black text-[8px] uppercase shrink-0 transition hover:opacity-90 ${
                hasIssues
                    ? 'ring-amber-500/50 text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300'
                    : 'ring-indigo-400/50 text-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-300'
            }`}
        >
            <LayoutGrid size={12} strokeWidth={2.5} />
            <span className="hidden sm:inline">Turnos</span>
        </button>
    );
}
