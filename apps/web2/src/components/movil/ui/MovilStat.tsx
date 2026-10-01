import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { MovilIconBox } from './MovilIconBox';
import { MovilProgress } from './MovilProgress';
import { MOVIL_CARD, MOVIL_NUMBER, MOVIL_RING, type MovilTone } from './tones';

export interface MovilStatProps {
  icon: LucideIcon;
  tone: MovilTone;
  /** Etiqueta en MAYÚSCULAS (ej. «ACTIVOS»). */
  label: string;
  value: ReactNode;
  /** Etiqueta arriba a la derecha (ej. «99%»). */
  badge?: ReactNode;
  /** Línea chica debajo del número. */
  sub?: ReactNode;
  /** Barra de progreso 0–100. */
  pct?: number;
  /** Con `onClick` funciona como filtro; `active` lo rellena con el color de la empresa. */
  onClick?: () => void;
  active?: boolean;
  /** Versión apretada para grillas de 3 columnas en 390px. */
  compact?: boolean;
  attrs?: Record<string, string | undefined>;
  className?: string;
}

/** KPI: ícono gris, etiqueta en mayúsculas, número tabular (en color solo si es estado). Sin sombra. */
export function MovilStat({ icon, tone, label, value, badge, sub, pct, onClick, active = false, compact = false, attrs, className = '' }: MovilStatProps) {
  const shell = `flex w-full flex-col text-left ${compact ? 'gap-0.5 p-2.5' : 'gap-1 p-4'} ${active ? `rounded-lg border border-transparent ${MOVIL_RING[tone]}` : MOVIL_CARD} ${className}`;
  const number = active ? 'text-inherit' : MOVIL_NUMBER[tone];
  const labelCls = active ? 'text-inherit opacity-80' : 'text-slate-500';
  const body = (
    <>
      <div className={`flex items-center justify-between ${compact ? '' : 'mb-1'}`}>
        <MovilIconBox icon={icon} tone={tone} size="sm" className={active ? 'text-inherit' : ''} />
        {badge}
      </div>
      <p className={`font-semibold uppercase tracking-wide ${compact ? 'text-[9px]' : 'text-[10px]'} ${labelCls}`}>{label}</p>
      <b className={`block font-bold leading-none tabular-nums ${compact ? 'text-2xl' : 'text-3xl'} ${number}`}>{value}</b>
      {sub && <p className={`mt-0.5 text-[10px] font-medium ${active ? 'text-inherit opacity-80' : 'text-slate-400'}`}>{sub}</p>}
      {typeof pct === 'number' && <MovilProgress pct={pct} tone={tone} className="mt-1" />}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} {...attrs} className={shell}>
        {body}
      </button>
    );
  }
  return (
    <div {...attrs} className={shell}>
      {body}
    </div>
  );
}
