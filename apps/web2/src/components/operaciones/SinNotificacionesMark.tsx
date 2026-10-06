import { BellOff } from 'lucide-react';
import { textoSinNotificacionesDe } from '@/lib/operaciones/pushAviso';

/** Campana apagada: el guardia no recibe el push de la app. */
export function SinNotificacionesMark({
  shift,
  size = 12,
  className = '',
}: {
  shift: { pushEstado?: unknown; pushEstadoAt?: unknown; isUnassigned?: boolean } | null | undefined;
  size?: number;
  className?: string;
}) {
  const title = textoSinNotificacionesDe(shift);
  if (!title) return null;
  return (
    <span
      title={title}
      aria-label={title}
      data-ops-sin-avisos="1"
      className={`inline-flex shrink-0 text-amber-600 ${className}`}
    >
      <BellOff size={size} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}
