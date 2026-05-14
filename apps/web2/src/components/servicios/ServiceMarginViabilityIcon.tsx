'use client';

import React, { useMemo } from 'react';
import { Activity } from 'lucide-react';
import {
    evaluateServiceMargin,
    marginEvaluationIconMeta,
    mergeDefaultServiceMarginVariables,
} from '@/lib/servicios/serviceMarginOptimizer';

const toneRing: Record<string, string> = {
    emerald: 'ring-emerald-500/50 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300',
    amber: 'ring-amber-500/50 text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300',
    rose: 'ring-rose-500/50 text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300',
    slate: 'ring-slate-400/40 text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400',
};

export interface ServiceMarginViabilityIconProps {
    slaHours: number;
    onOpen: () => void;
}

export function ServiceMarginViabilityIcon({ slaHours, onOpen }: ServiceMarginViabilityIconProps) {
    const meta = useMemo(() => {
        const ev = evaluateServiceMargin(mergeDefaultServiceMarginVariables({ totalSlaHours: slaHours }));
        return marginEvaluationIconMeta(ev);
    }, [slaHours]);

    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onOpen();
            }}
            title={meta.hint}
            className={`inline-flex items-center gap-0.5 rounded-lg px-1.5 py-1 ring-1 font-black text-[8px] uppercase shrink-0 transition hover:opacity-90 ${toneRing[meta.tone] || toneRing.slate}`}
        >
            <Activity size={12} strokeWidth={2.5} />
            <span className="hidden sm:inline">{meta.shortLabel}</span>
        </button>
    );
}
