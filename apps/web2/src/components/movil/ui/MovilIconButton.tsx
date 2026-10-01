import type { LucideIcon } from 'lucide-react';

/** Botón de ícono: blanco con borde gris, ícono en gris oscuro (en color solo si es estado). Sin sombra. */
export function MovilIconButton({
  icon: Icon,
  label,
  onClick,
  tone = 'slate',
  disabled = false,
  attrs,
  className = '',
}: {
  icon: LucideIcon;
  /** Texto accesible (aria-label). */
  label: string;
  onClick: () => void;
  tone?: 'slate' | 'indigo' | 'emerald' | 'rose';
  disabled?: boolean;
  attrs?: Record<string, string | undefined>;
  className?: string;
}) {
  const cls = tone === 'emerald'
    ? 'text-emerald-600'
    : tone === 'rose'
      ? 'text-rose-600'
      : 'text-slate-700';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      {...attrs}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white active:bg-slate-50 disabled:opacity-40 ${cls} ${className}`}
    >
      <Icon size={18} strokeWidth={1.75} />
    </button>
  );
}
