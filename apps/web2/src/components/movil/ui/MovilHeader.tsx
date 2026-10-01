import { ChevronLeft, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Fecha del encabezado: «jueves 1 de octubre de 2026» (se muestra en mayúsculas por CSS). */
export function movilFechaLarga(date: Date = new Date()): string {
  return date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Encabezado de pantalla: ícono lucide gris (sin cuadro), título en MAYÚSCULAS espaciadas
 * y debajo la fecha o el subtítulo en gris. Sin sombras.
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
    <header className={`flex items-center gap-2.5 ${className}`}>
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Volver" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 active:bg-slate-50">
          <ChevronLeft size={18} strokeWidth={1.75} />
        </button>
      )}
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center text-slate-700">
        <Icon size={22} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="text-[17px] font-semibold uppercase leading-none tracking-wider text-slate-900">{title}</h1>
        <p className="mt-1 truncate text-[10px] font-medium uppercase tracking-widest text-slate-500">{subtitle ?? movilFechaLarga(date)}</p>
      </div>
      {right && <div className="flex shrink-0 items-center gap-1.5">{right}</div>}
    </header>
  );
}
