import { Building2, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { MOVIL_TOPBAR_BG } from './tones';

/**
 * Barra superior de todos los módulos del celular: fondo con el tono oscuro del color de
 * la empresa (`--movil-topbar`; negro si no hay empresa), nombre del módulo en mayúsculas
 * espaciadas y empresa en píldora con borde (sin relleno). Sin sombra.
 */
export function MovilTopBar({
  modulo,
  empresa,
  right,
  online = true,
  offlineLabel = 'Sin señal · se muestra lo último',
  pendingLabel = null,
  onEmpresa,
  sticky = true,
}: {
  modulo: string;
  empresa: string;
  right?: ReactNode;
  online?: boolean;
  offlineLabel?: string;
  /** «Pendiente de enviar: …» cuando hay escrituras en cola. */
  pendingLabel?: string | null;
  /** Si viene, la píldora de empresa es un botón (cambio de empresa). */
  onEmpresa?: () => void;
  sticky?: boolean;
}) {
  const pill = 'flex min-h-8 max-w-[60%] items-center gap-1.5 rounded-full border border-white/40 bg-transparent pl-2.5 pr-3 text-[11px] font-medium text-white';
  return (
    <div className={`${sticky ? 'sticky top-0 z-20' : ''} ${MOVIL_TOPBAR_BG}`} data-movil-topbar={modulo}>
      <div className="flex min-h-12 items-center gap-2 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.2em] text-white">{modulo}</span>
          {onEmpresa ? (
            <button type="button" onClick={onEmpresa} className={`${pill} active:bg-white/10`} aria-label={`Empresa ${empresa}. Cambiar`}>
              <Building2 size={13} strokeWidth={1.75} className="shrink-0 text-white/80" />
              <span className="truncate">{empresa}</span>
            </button>
          ) : (
            <span className={pill} data-movil-empresa={empresa}>
              <Building2 size={13} strokeWidth={1.75} className="shrink-0 text-white/80" />
              <span className="truncate">{empresa}</span>
            </span>
          )}
        </div>
        {right && <div className="flex shrink-0 items-center gap-1.5">{right}</div>}
      </div>
      {!online && (
        <p className="flex items-center gap-1.5 border-t border-white/15 px-3 py-1 text-[11px] font-medium text-white/90">
          <WifiOff size={12} strokeWidth={1.75} /> {offlineLabel}
        </p>
      )}
      {pendingLabel && (
        <p className="border-t border-white/15 px-3 py-1 text-[11px] font-medium text-amber-300">Pendiente de enviar: {pendingLabel}</p>
      )}
    </div>
  );
}
