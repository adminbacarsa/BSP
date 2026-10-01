import type { LucideIcon } from 'lucide-react';
import { MOVIL_ICON_BOX, type MovilTone } from './tones';

/** Cuadrado redondeado pastel con ícono lucide (el de las KPI del escritorio). */
export function MovilIconBox({ icon: Icon, tone = 'slate', size = 'sm', className = '' }: {
  icon: LucideIcon;
  tone?: MovilTone;
  /** `sm` 32px (tarjetas), `md` 40px (filas), `lg` 48px (encabezado). */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const box = size === 'lg' ? 'h-12 w-12 rounded-xl' : size === 'md' ? 'h-10 w-10 rounded-xl' : 'h-8 w-8 rounded-lg';
  const px = size === 'lg' ? 22 : size === 'md' ? 18 : 16;
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center ${box} ${MOVIL_ICON_BOX[tone]} ${className}`}>
      <Icon size={px} strokeWidth={2.2} />
    </span>
  );
}
