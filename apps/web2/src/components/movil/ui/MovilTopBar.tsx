import { Building2, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Barra superior oscura de todos los módulos del celular: nombre del módulo,
 * empresa en píldora y un espacio a la derecha (botón de la sala, «Solo lectura», etc.).
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
  const pill = 'flex min-h-9 max-w-[60%] items-center gap-1.5 rounded-full bg-white/10 pl-2.5 pr-3 text-[11px] font-black text-white';
  return (
    <div className={`${sticky ? 'sticky top-0 z-20' : ''} bg-slate-900 text-white shadow-lg shadow-slate-900/20`} data-movil-topbar={modulo}>
      <div className="flex min-h-14 items-center gap-2 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-[11px] font-black uppercase tracking-widest text-slate-300">{modulo}</span>
          {onEmpresa ? (
            <button type="button" onClick={onEmpresa} className={`${pill} active:bg-white/20`} aria-label={`Empresa ${empresa}. Cambiar`}>
              <Building2 size={13} strokeWidth={2.4} className="shrink-0 text-slate-300" />
              <span className="truncate">{empresa}</span>
            </button>
          ) : (
            <span className={pill} data-movil-empresa={empresa}>
              <Building2 size={13} strokeWidth={2.4} className="shrink-0 text-slate-300" />
              <span className="truncate">{empresa}</span>
            </span>
          )}
        </div>
        {right && <div className="flex shrink-0 items-center gap-1.5">{right}</div>}
      </div>
      {!online && (
        <p className="flex items-center gap-1.5 bg-slate-800 px-3 py-1 text-[11px] font-bold text-slate-200">
          <WifiOff size={12} /> {offlineLabel}
        </p>
      )}
      {pendingLabel && (
        <p className="bg-amber-500/15 px-3 py-1 text-[11px] font-bold text-amber-200">Pendiente de enviar: {pendingLabel}</p>
      )}
    </div>
  );
}
