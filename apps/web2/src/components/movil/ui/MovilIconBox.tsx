import type { LucideIcon } from 'lucide-react';
import { MOVIL_ICON_BOX, type MovilTone } from './tones';

/** Ícono lucide de trazo fino, gris oscuro (en color solo si es estado). Sin cuadro de fondo. */
export function MovilIconBox({ icon: Icon, tone = 'slate', size = 'sm', className = '' }: {
  icon: LucideIcon;
  tone?: MovilTone;
  /** `sm` 16px (tarjetas), `md` 18px (filas), `lg` 22px (encabezado). */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const box = size === 'lg' ? 'h-9 w-9' : size === 'md' ? 'h-8 w-8' : 'h-6 w-6';
  const px = size === 'lg' ? 22 : size === 'md' ? 18 : 16;
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center ${box} ${MOVIL_ICON_BOX[tone]} ${className}`}>
      <Icon size={px} strokeWidth={1.75} />
    </span>
  );
}
