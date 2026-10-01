import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { MovilIconBox } from './MovilIconBox';
import { MovilProgress } from './MovilProgress';
import { MOVIL_NUMBER, MOVIL_RING, type MovilTone } from './tones';

export interface MovilStatProps {
  icon: LucideIcon;
  tone: MovilTone;
  /** Etiqueta en MAYÚSCULAS (ej. «ACTIVOS»). */
  label: string;
  value: ReactNode;
  /** Píldora arriba a la derecha (ej. «99%»). */
  badge?: ReactNode;
  /** Línea chica debajo del número. */
  sub?: ReactNode;
  /** Barra de progreso 0–100. */
  pct?: number;
  /** Con `onClick` funciona como filtro; `active` dibuja el anillo. */
  onClick?: () => void;
  active?: boolean;
  /** Versión apretada para grillas de 3 columnas en 390px. */
  compact?: boolean;
  attrs?: Record<string, string | undefined>;
  className?: string;
}

/** KPI del escritorio: ícono pastel, etiqueta en mayúsculas, número grande con color de estado. */
export function MovilStat({ icon, tone, label, value, badge, sub, pct, onClick, active = false, compact = false, attrs, className = '' }: MovilStatProps) {
  const shell = `flex w-full flex-col rounded-2xl border bg-white text-left shadow-sm ${compact ? 'gap-0.5 p-2.5' : 'gap-1 p-4'} ${active ? `border-transparent ring-2 ${MOVIL_RING[tone]}` : 'border-slate-100'} ${onClick ? 'active:scale-[0.98]' : ''} ${className}`;
  const body = (
    <>
      <div className={`flex items-center justify-between ${compact ? '' : 'mb-1'}`}>
        <MovilIconBox icon={icon} tone={tone} size="sm" />
        {badge}
      </div>
      <p className={`font-black uppercase tracking-wide text-slate-600 ${compact ? 'text-[9px]' : 'text-[10px]'}`}>{label}</p>
      <b className={`block font-black leading-none ${compact ? 'text-2xl' : 'text-3xl'} ${MOVIL_NUMBER[tone]}`}>{value}</b>
      {sub && <p className="mt-0.5 text-[10px] font-semibold text-slate-400">{sub}</p>}
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
