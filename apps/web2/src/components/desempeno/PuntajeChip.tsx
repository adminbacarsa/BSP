import { useState } from 'react';
import { usePuntaje } from '@/context/guardiaPuntajeStore';

function fechaCorta(ms?: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

/** Chip 0–100. No se renderiza si el servidor todavía no escribió el doc. */
export function PuntajeChip({ sujetoId }: { sujetoId?: string | null }) {
  const fila = usePuntaje(sujetoId);
  const [abierto, setAbierto] = useState(false);
  if (!fila || !sujetoId) return null;
  const tono = fila.total >= 80 ? 'emerald' : fila.total >= 60 ? 'amber' : 'rose';
  const cls = tono === 'emerald'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : tono === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-rose-200 bg-rose-50 text-rose-700';
  const detalle = [...fila.detalle].slice(0, 12);
  return (
    <span
      className="relative inline-flex shrink-0"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span
        role="button"
        tabIndex={0}
        title={`Cumplimiento ${fila.cumplimiento} · Disposición ${fila.disposicion}`}
        className={`cursor-pointer rounded-full border px-1.5 text-[9px] font-black tabular-nums leading-4 shadow-sm ${cls}`}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setAbierto((v) => !v); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            setAbierto((v) => !v);
          }
        }}
      >
        {fila.total}
      </span>
      {abierto && (
        <span className="absolute left-0 top-5 z-[80] w-64 rounded-2xl border border-slate-200 bg-white p-2.5 text-left shadow-lg">
          <span className="block text-[10px] font-black uppercase tracking-wide text-slate-500">
            {fila.total} · cumplimiento {fila.cumplimiento} · disposición {fila.disposicion}
          </span>
          <span className="mt-1 block max-h-48 overflow-y-auto">
            {detalle.length === 0 && (
              <span className="block py-1 text-[11px] text-slate-500">Sin movimientos en 90 días.</span>
            )}
            {detalle.map((item, i) => (
              <span key={`${item.tipo}-${item.fechaMs || i}`} className="flex items-start justify-between gap-2 border-t border-slate-100 py-1 text-[11px]">
                <span className="min-w-0">
                  <span className={`block font-bold ${item.delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{item.etiqueta || item.tipo}</span>
                  <span className="block text-[10px] text-slate-400">{fechaCorta(item.fechaMs)} · {item.componente === 'CUMPLIMIENTO' ? 'cumplimiento' : 'disposición'}</span>
                </span>
                <span className={`shrink-0 font-black tabular-nums ${item.delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {item.delta > 0 ? `+${item.delta}` : item.delta}
                </span>
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}
