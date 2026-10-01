import React, { type ReactNode } from 'react';
import { MOVIL_TEXT, type MovilTone } from './tones';

/**
 * Etiqueta de estado: texto en color, mayúsculas, sin relleno.
 * `outline` la dibuja en recuadro con borde (código de turno, «PC», «Solo lectura»).
 */
export function MovilBadge({
  children,
  tone = 'slate',
  size = 'sm',
  outline = false,
  className = '',
  attrs,
}: {
  children: ReactNode;
  tone?: MovilTone;
  /** `sm` = etiqueta (10px); `md` = número destacado (12px). */
  size?: 'sm' | 'md';
  outline?: boolean;
  className?: string;
  attrs?: Record<string, string | undefined>;
}) {
  const sizeCls = size === 'md' ? 'text-[12px]' : 'text-[10px] tracking-wide';
  const shape = outline ? 'rounded border border-slate-300 px-1.5 leading-5' : '';
  return (
    <span {...attrs} className={`inline-flex shrink-0 items-center gap-1 font-bold uppercase tabular-nums ${sizeCls} ${shape} ${MOVIL_TEXT[tone]} ${className}`}>
      {children}
    </span>
  );
}
