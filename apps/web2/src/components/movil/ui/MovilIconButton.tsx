import type { LucideIcon } from 'lucide-react';

/** Botón de ícono en cuadrado redondeado slate-50 (los del encabezado del escritorio). */
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
  const cls = tone === 'indigo'
    ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
    : tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
      : tone === 'rose'
        ? 'bg-rose-50 text-rose-700 border-rose-100'
        : 'bg-slate-50 text-slate-600 border-slate-100';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      {...attrs}
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border shadow-sm transition-colors active:scale-95 disabled:opacity-40 ${cls} ${className}`}
    >
      <Icon size={18} strokeWidth={2.2} />
    </button>
  );
}
