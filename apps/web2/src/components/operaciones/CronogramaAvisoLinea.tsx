import React, { useState } from 'react';
import { CalendarX2, Check } from 'lucide-react';

/**
 * Operación (escritorio): la única huella de CRONOGRAMA_SIN_PUBLICAR en el Centro de Comando.
 * Una línea informativa agrupada («3 objetivos cortan mañana a las 07:00 por falta de cronograma»)
 * con «Marcar como vista». La lista por objetivo vive en Planificación.
 */
export function CronogramaAvisoLinea({ texto, onVista }: { texto: string; onVista: () => Promise<unknown> | void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="mx-3 mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
      data-cronograma-aviso="1"
    >
      <CalendarX2 size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
      <span className="flex-1 font-medium">{texto}</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try { await onVista(); } finally { setBusy(false); }
        }}
        className="flex shrink-0 items-center gap-1 rounded-lg border border-amber-300 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800 hover:bg-amber-100 active:scale-95 disabled:opacity-50"
        title="Marcar como vista"
      >
        <Check size={12} strokeWidth={2} aria-hidden="true" /> Vista
      </button>
    </div>
  );
}
