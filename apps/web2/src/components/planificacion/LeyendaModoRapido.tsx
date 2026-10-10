import React from 'react';
import { armarLeyenda, lineaLeyenda, type TurnoLeyenda } from '@/lib/planificacion/leyendaModoRapido';

const ROJO = new Set(['D12', 'N12']);

export function LeyendaModoRapido({
  puestos,
  usados,
  abierta,
  onToggle,
  estilo,
}: {
  puestos: readonly { name: string; shifts: readonly TurnoLeyenda[] }[];
  usados: ReadonlySet<string>;
  abierta: boolean;
  onToggle: () => void;
  estilo: (code: string) => string;
}) {
  const grupos = armarLeyenda(puestos, usados);
  if (!grupos.length) return null;
  if (!abierta) {
    return (
      <button type="button" onClick={onToggle} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-left text-[11px] text-slate-600 shadow-sm" data-leyenda-modo-rapido="linea">
        {grupos.map(lineaLeyenda).join('   ')}
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm" data-leyenda-modo-rapido="abierta">
      <button type="button" onClick={onToggle} className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Leyenda de este cronograma</button>
      <div className="space-y-1">
        {grupos.map((g) => (
          <div key={g.titulo} className="flex flex-wrap items-center gap-1" data-leyenda-grupo={g.titulo}>
            <span className="mr-1 text-[10px] font-black uppercase text-slate-500">{g.titulo}</span>
            {g.chips.map((c) => (
              <span key={`${g.titulo}-${c.code}`} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-black ${ROJO.has(c.code) ? 'bg-red-600 text-white' : estilo(c.code) || 'bg-slate-100 text-slate-700'}`} data-leyenda-chip={c.code}>
                {c.code}{c.detalle ? ` ${c.detalle}` : ''}{c.horario ? ` ${c.horario}` : ''}{c.horas ? ` · ${c.horas} h` : ''}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
