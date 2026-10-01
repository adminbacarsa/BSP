/**
 * Estilo del celular (versión final de Mauro): serio, profesional, minimalista.
 * Base neutra (blanco / grises), tipografía de sistema con números tabulares, sin cuadros
 * pastel, sin degradés ni sombras. El color se usa SOLO para estado (verde activo, ámbar
 * tarde, naranja retenido, rojo ausente/vacante) y el color de la empresa SOLO en barra
 * superior, botón primario, contador seleccionado, pestaña activa, selector y foco.
 * El color de la empresa llega por variables CSS (`applyCompanyTheme` → `--movil-*`);
 * sin empresa el primario es negro.
 */
export type MovilTone = 'emerald' | 'rose' | 'amber' | 'orange' | 'blue' | 'indigo' | 'violet' | 'slate';

/** Borde gris muy claro de tarjetas y separadores. */
export const MOVIL_BORDER = 'border-[#eceef1]';
/** Tarjeta: blanca, borde gris muy claro, radio 8 px, sin sombra. */
export const MOVIL_CARD = `rounded-lg border ${MOVIL_BORDER} bg-white`;
/** Tipografía de sistema (Roboto en Android) con números tabulares. */
export const MOVIL_FONT = '[font-family:system-ui,Roboto,"Segoe_UI",sans-serif] tabular-nums';

/** Color de la empresa (negro si no hay empresa). */
export const MOVIL_TOPBAR_BG = 'bg-[var(--movil-topbar,#111827)] text-white';
export const MOVIL_PRIMARY_BG = 'bg-[var(--movil-primary,#111827)] text-[var(--movil-primary-text,#ffffff)]';
export const MOVIL_PRIMARY_TEXT = 'text-[var(--movil-primary,#111827)]';
export const MOVIL_PRIMARY_BORDER = 'border-[var(--movil-primary,#111827)]';
/** Botón primario (empresa / negro) y secundario (blanco con borde). */
export const MOVIL_BTN_PRIMARY = `${MOVIL_PRIMARY_BG} border border-transparent`;
export const MOVIL_BTN_SECONDARY = 'border border-slate-300 bg-white text-slate-900';

/** Texto de estado en color (sin relleno). Los tonos decorativos quedan en gris. */
export const MOVIL_TEXT: Record<MovilTone, string> = {
  emerald: 'text-emerald-600',
  rose: 'text-rose-600',
  amber: 'text-amber-600',
  orange: 'text-orange-600',
  blue: 'text-slate-700',
  indigo: 'text-slate-700',
  violet: 'text-slate-700',
  slate: 'text-slate-500',
};

/** Ícono (trazo fino, gris oscuro; en color solo si es estado). Sin cuadro de fondo. */
export const MOVIL_ICON_BOX: Record<MovilTone, string> = {
  emerald: 'text-emerald-600',
  rose: 'text-rose-600',
  amber: 'text-amber-600',
  orange: 'text-orange-600',
  blue: 'text-slate-700',
  indigo: 'text-slate-700',
  violet: 'text-slate-700',
  slate: 'text-slate-700',
};

/** Número grande: negro, salvo que sea un estado. */
export const MOVIL_NUMBER: Record<MovilTone, string> = {
  emerald: 'text-emerald-600',
  rose: 'text-rose-600',
  amber: 'text-amber-600',
  orange: 'text-orange-600',
  blue: 'text-slate-900',
  indigo: 'text-slate-900',
  violet: 'text-slate-900',
  slate: 'text-slate-900',
};

/** Píldora = texto en color, sin relleno. */
export const MOVIL_PILL: Record<MovilTone, string> = MOVIL_TEXT;

/** Relleno de la barra de progreso (estado). */
export const MOVIL_BAR: Record<MovilTone, string> = {
  emerald: 'bg-emerald-500',
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  blue: 'bg-slate-700',
  indigo: 'bg-slate-700',
  violet: 'bg-slate-700',
  slate: 'bg-slate-400',
};

/** Filete de 3 px a la izquierda de la tarjeta (estado). */
export const MOVIL_FILETE: Record<MovilTone, string> = {
  emerald: 'bg-emerald-500',
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  blue: 'bg-slate-400',
  indigo: 'bg-slate-400',
  violet: 'bg-slate-400',
  slate: 'bg-slate-300',
};

/** Filtro / contador seleccionado: relleno con el color de la empresa (negro por defecto). */
export const MOVIL_RING: Record<MovilTone, string> = {
  emerald: MOVIL_PRIMARY_BG,
  rose: MOVIL_PRIMARY_BG,
  amber: MOVIL_PRIMARY_BG,
  orange: MOVIL_PRIMARY_BG,
  blue: MOVIL_PRIMARY_BG,
  indigo: MOVIL_PRIMARY_BG,
  violet: MOVIL_PRIMARY_BG,
  slate: MOVIL_PRIMARY_BG,
};

/** Tono según porcentaje de cobertura (100 verde, ≥75 ámbar, menos rojo). */
export function toneForPct(pct: number): MovilTone {
  if (pct >= 100) return 'emerald';
  if (pct >= 75) return 'amber';
  return 'rose';
}

/** Estado del guardia (`guardTone`) → tono visual. Plan no es estado: gris. */
export function toneForGuard(tone: string): MovilTone {
  switch (tone) {
    case 'ok': return 'emerald';
    case 'ret': return 'orange';
    case 'late': return 'amber';
    case 'vac': return 'rose';
    default: return 'slate';
  }
}
