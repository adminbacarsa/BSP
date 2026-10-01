/**
 * Paleta del celular = la del panel de escritorio: slate + acentos de estado.
 * Un solo lugar para los pares pastel/texto que usan tarjetas, KPIs y píldoras.
 */
export type MovilTone = 'emerald' | 'rose' | 'amber' | 'orange' | 'blue' | 'indigo' | 'violet' | 'slate';

/** Cuadrado redondeado pastel con el ícono (arriba a la izquierda). */
export const MOVIL_ICON_BOX: Record<MovilTone, string> = {
  emerald: 'bg-emerald-50 text-emerald-600',
  rose: 'bg-rose-50 text-rose-600',
  amber: 'bg-amber-50 text-amber-600',
  orange: 'bg-orange-50 text-orange-600',
  blue: 'bg-blue-50 text-blue-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  violet: 'bg-violet-50 text-violet-600',
  slate: 'bg-slate-100 text-slate-600',
};

/** Número grande en negrita. */
export const MOVIL_NUMBER: Record<MovilTone, string> = {
  emerald: 'text-emerald-600',
  rose: 'text-rose-600',
  amber: 'text-amber-500',
  orange: 'text-orange-600',
  blue: 'text-blue-600',
  indigo: 'text-indigo-600',
  violet: 'text-violet-600',
  slate: 'text-slate-700',
};

/** Píldora de badge (arriba a la derecha). */
export const MOVIL_PILL: Record<MovilTone, string> = {
  emerald: 'bg-emerald-50 text-emerald-600',
  rose: 'bg-rose-50 text-rose-600',
  amber: 'bg-amber-50 text-amber-600',
  orange: 'bg-orange-50 text-orange-700',
  blue: 'bg-blue-50 text-blue-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  violet: 'bg-violet-50 text-violet-700',
  slate: 'bg-slate-50 text-slate-500',
};

/** Relleno de la barra de progreso. */
export const MOVIL_BAR: Record<MovilTone, string> = {
  emerald: 'bg-emerald-500',
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  slate: 'bg-slate-400',
};

/** Anillo del KPI cuando está activo como filtro. */
export const MOVIL_RING: Record<MovilTone, string> = {
  emerald: 'ring-emerald-500 bg-emerald-50/60',
  rose: 'ring-rose-500 bg-rose-50/60',
  amber: 'ring-amber-500 bg-amber-50/60',
  orange: 'ring-orange-500 bg-orange-50/60',
  blue: 'ring-blue-500 bg-blue-50/60',
  indigo: 'ring-indigo-500 bg-indigo-50/60',
  violet: 'ring-violet-500 bg-violet-50/60',
  slate: 'ring-slate-600 bg-slate-100',
};

/** Tono según porcentaje de cobertura (100 verde, ≥75 ámbar, menos rojo). */
export function toneForPct(pct: number): MovilTone {
  if (pct >= 100) return 'emerald';
  if (pct >= 75) return 'amber';
  return 'rose';
}

/** Estado del guardia (`guardTone`) → tono visual. */
export function toneForGuard(tone: string): MovilTone {
  switch (tone) {
    case 'ok': return 'emerald';
    case 'ret': return 'orange';
    case 'late': return 'amber';
    case 'vac': return 'rose';
    case 'plan': return 'indigo';
    default: return 'slate';
  }
}
