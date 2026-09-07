'use client';

import React from 'react';
import { Gauge } from 'lucide-react';

export interface ServiceCapacityViabilityIconProps {
  onOpen: () => void;
  /** Horas perdidas vs SLA (0 = cubierto). Null = sin dato. */
  horasPerdidas?: number | null;
  plantilla?: number;
}

export function ServiceCapacityViabilityIcon({
  onOpen,
  horasPerdidas,
  plantilla,
}: ServiceCapacityViabilityIconProps) {
  const has = typeof horasPerdidas === 'number' && Number.isFinite(horasPerdidas);
  const lost = has ? Math.max(0, horasPerdidas!) : 0;
  const tone =
    !has
      ? 'ring-indigo-400/50 text-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-300'
      : lost <= 0
        ? 'ring-emerald-500/40 text-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300'
        : lost < 40
          ? 'ring-amber-500/40 text-amber-800 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-200'
          : 'ring-rose-500/40 text-rose-800 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300';

  const badgeTone =
    !has
      ? ''
      : lost <= 0
        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
        : lost < 40
          ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
          : 'bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200';

  const title = has
    ? `Viabilidad — hs perdidas ${lost}${plantilla != null ? ` · ${plantilla} en plantilla` : ''}`
    : 'Viabilidad del servicio (capacidad 200 + informe mes)';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title={title}
      className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-1 ring-1 font-black text-[8px] uppercase shrink-0 transition hover:opacity-90 ${tone}`}
    >
      <Gauge size={12} strokeWidth={2.5} />
      <span className="hidden sm:inline">Viab.</span>
      {has && (
        <span
          className={`tabular-nums min-w-[1.6rem] text-center rounded px-0.5 text-[9px] font-black leading-none py-0.5 ${badgeTone}`}
          aria-hidden
        >
          {lost <= 0 ? 'OK' : `${Math.round(lost)}h`}
        </span>
      )}
    </button>
  );
}
