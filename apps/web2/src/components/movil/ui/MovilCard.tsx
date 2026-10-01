import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { MovilIconBox } from './MovilIconBox';
import type { MovilTone } from './tones';

export interface MovilCardProps {
  /** Ícono en cuadrado pastel arriba a la izquierda. */
  icon?: LucideIcon;
  tone?: MovilTone;
  /** Píldora u otro contenido arriba a la derecha. */
  badge?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  /** Con `onClick` la tarjeta es un botón (toda la superficie toca). */
  onClick?: () => void;
  className?: string;
  /** Atributos `data-*` / aria para tests y deep-links. */
  attrs?: Record<string, string | undefined>;
  /** Realce del borde (alerta, filtro activo). */
  ring?: MovilTone | null;
}

const RING: Record<MovilTone, string> = {
  emerald: 'ring-2 ring-emerald-400 border-transparent',
  rose: 'ring-2 ring-rose-400 border-transparent',
  amber: 'ring-2 ring-amber-400 border-transparent',
  orange: 'ring-2 ring-orange-400 border-transparent',
  blue: 'ring-2 ring-blue-400 border-transparent',
  indigo: 'ring-2 ring-indigo-400 border-transparent',
  violet: 'ring-2 ring-violet-400 border-transparent',
  slate: 'ring-2 ring-slate-400 border-transparent',
};

/**
 * Tarjeta blanca del escritorio: rounded-2xl, borde slate-100, sombra muy suave,
 * ícono pastel a la izquierda y badge a la derecha.
 */
export function MovilCard({ icon, tone = 'slate', badge, title, subtitle, children, onClick, className = '', attrs, ring = null }: MovilCardProps) {
  const base = `block w-full rounded-2xl border bg-white p-3 text-left shadow-sm ${ring ? RING[ring] : 'border-slate-100'} ${onClick ? 'active:scale-[0.99] active:bg-slate-50' : ''} ${className}`;
  const head = (icon || title || badge) && (
    <div className="flex items-start gap-2.5">
      {icon && <MovilIconBox icon={icon} tone={tone} size="md" />}
      <div className="min-w-0 flex-1">
        {title && <div className="truncate text-[15px] font-black leading-tight text-slate-900">{title}</div>}
        {subtitle && <div className="truncate text-[11px] font-semibold text-slate-500">{subtitle}</div>}
      </div>
      {badge && <div className="ml-auto flex shrink-0 items-center gap-1">{badge}</div>}
    </div>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} {...attrs} className={base}>
        {head}
        {children}
      </button>
    );
  }
  return (
    <article {...attrs} className={base}>
      {head}
      {children}
    </article>
  );
}
