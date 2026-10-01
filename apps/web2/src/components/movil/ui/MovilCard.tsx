import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { MovilIconBox } from './MovilIconBox';
import { MOVIL_CARD, MOVIL_FILETE, type MovilTone } from './tones';

export interface MovilCardProps {
  /** Ícono lucide gris a la izquierda (sin cuadro). */
  icon?: LucideIcon;
  tone?: MovilTone;
  /** Etiqueta u otro contenido arriba a la derecha. */
  badge?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  /** Con `onClick` la tarjeta es un botón (toda la superficie toca). */
  onClick?: () => void;
  className?: string;
  /** Atributos `data-*` / aria para tests y deep-links. */
  attrs?: Record<string, string | undefined>;
  /** Filete de 3 px a la izquierda con el color del estado (alerta, filtro activo). */
  ring?: MovilTone | null;
}

/**
 * Tarjeta blanca con borde gris muy claro (#eceef1), radio 8 px, sin sombra.
 * El estado se comunica con el filete izquierdo (`ring`) y texto en color, no con rellenos.
 */
export function MovilCard({ icon, tone = 'slate', badge, title, subtitle, children, onClick, className = '', attrs, ring = null }: MovilCardProps) {
  const base = `relative block w-full ${MOVIL_CARD} p-3 text-left ${ring ? 'pl-4' : ''} ${onClick ? 'active:bg-slate-50' : ''} ${className}`;
  const filete = ring ? <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] rounded-l-lg ${MOVIL_FILETE[ring]}`} /> : null;
  const head = (icon || title || badge) && (
    <div className="flex items-start gap-2.5">
      {icon && <MovilIconBox icon={icon} tone={tone} size="md" />}
      <div className="min-w-0 flex-1">
        {title && <div className="truncate text-[15px] font-semibold leading-tight text-slate-900">{title}</div>}
        {subtitle && <div className="truncate text-[11px] font-medium text-slate-500">{subtitle}</div>}
      </div>
      {badge && <div className="ml-auto flex shrink-0 items-center gap-1">{badge}</div>}
    </div>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} {...attrs} className={base}>
        {filete}
        {head}
        {children}
      </button>
    );
  }
  return (
    <article {...attrs} className={base}>
      {filete}
      {head}
      {children}
    </article>
  );
}
