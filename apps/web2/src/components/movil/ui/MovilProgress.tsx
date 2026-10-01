import { MOVIL_BAR, type MovilTone } from './tones';

/** Barra de progreso fina (h-1, fondo gris claro). El color es el del estado. */
export function MovilProgress({ pct, tone = 'emerald', className = '' }: { pct: number; tone?: MovilTone; className?: string }) {
  const width = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className={`h-1 w-full overflow-hidden rounded bg-slate-100 ${className}`} role="progressbar" aria-valuenow={width} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded ${MOVIL_BAR[tone]}`} style={{ width: `${width}%` }} />
    </div>
  );
}
