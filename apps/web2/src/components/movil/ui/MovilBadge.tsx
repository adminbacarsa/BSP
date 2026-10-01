import type { ReactNode } from 'react';
import { MOVIL_PILL, type MovilTone } from './tones';

/** Píldora de badge del escritorio («99%», «NÓMINA»): mayúsculas, chica, color pastel. */
export function MovilBadge({
  children,
  tone = 'slate',
  size = 'sm',
  className = '',
  attrs,
}: {
  children: ReactNode;
  tone?: MovilTone;
  /** `sm` = etiqueta (9px); `md` = número destacado (12px). */
  size?: 'sm' | 'md';
  className?: string;
  attrs?: Record<string, string | undefined>;
}) {
  const sizeCls = size === 'md' ? 'px-2.5 py-1 text-[12px]' : 'px-2 py-0.5 text-[9px] tracking-wide';
  return (
    <span {...attrs} className={`inline-flex shrink-0 items-center gap-1 rounded-full font-black uppercase ${sizeCls} ${MOVIL_PILL[tone]} ${className}`}>
      {children}
    </span>
  );
}
