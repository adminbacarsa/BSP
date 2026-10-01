import { ChevronLeft, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Fecha del encabezado del escritorio: «jueves 1 de octubre de 2026» (se muestra en mayúsculas por CSS). */
export function movilFechaLarga(date: Date = new Date()): string {
  return date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Encabezado de `/admin/rrhh`: ícono en cuadrado redondeado gris-azulado con sombra suave,
 * título grande en MAYÚSCULAS y debajo la fecha (o subtítulo) en mayúsculas con tracking.
 */
export function MovilHeader({
  icon: Icon,
  title,
  subtitle,
  date,
  right,
  onBack,
  className = '',
}: {
  icon: LucideIcon;
  title: ReactNode;
  /** Reemplaza a la fecha. */
  subtitle?: ReactNode;
  /** Fecha a mostrar cuando no hay `subtitle`. Default hoy. */
  date?: Date;
  /** Botones de ícono a la derecha. */
  right?: ReactNode;
  /** Muestra la flecha para volver. */
  onBack?: () => void;
  className?: string;
}) {
  return (
    <header className={`flex items-center gap-3 ${className}`}>
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Volver" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-100 bg-slate-50 text-slate-600 shadow-sm active:scale-95">
          <ChevronLeft size={20} strokeWidth={2.4} />
        </button>
      )}
      <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-200/80 text-slate-700 shadow-md shadow-slate-300/50">
        <Icon size={22} strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] font-black uppercase leading-none tracking-tight text-slate-900">{title}</h1>
        <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">{subtitle ?? movilFechaLarga(date)}</p>
      </div>
      {right && <div className="flex shrink-0 items-center gap-1.5">{right}</div>}
    </header>
  );
}
