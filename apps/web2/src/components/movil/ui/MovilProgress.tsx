import { MOVIL_BAR, type MovilTone } from './tones';

/** Barra de progreso redondeada (h-1.5, fondo slate-100). */
export function MovilProgress({ pct, tone = 'emerald', className = '' }: { pct: number; tone?: MovilTone; className?: string }) {
  const width = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ${className}`} role="progressbar" aria-valuenow={width} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-all ${MOVIL_BAR[tone]}`} style={{ width: `${width}%` }} />
    </div>
  );
}
