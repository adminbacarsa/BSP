import React from 'react';
import { ChevronDown, ChevronUp, Palette } from 'lucide-react';
import { armarLeyenda, type TurnoLeyenda } from '@/lib/planificacion/leyendaModoRapido';

const ROJO = new Set(['D12', 'N12']);

export function LeyendaModoRapido({
  puestos,
  usados,
  abierta,
  onToggle,
  estilo,
  sinMarco = false,
}: {
  puestos: readonly { name: string; shifts: readonly TurnoLeyenda[] }[];
  usados: ReadonlySet<string>;
  abierta: boolean;
  onToggle: () => void;
  estilo: (code: string) => string;
  sinMarco?: boolean;
}) {
  const grupos = armarLeyenda(puestos, usados);
  if (!grupos.length) return null;
  const total = grupos.reduce((n, g) => n + g.chips.length, 0);
  return (
    <div
      className={sinMarco ? 'flex items-start gap-2' : 'flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1 shadow-sm'}
      data-leyenda-modo-rapido={abierta ? 'abierta' : 'linea'}
    >
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500 hover:bg-slate-100"
        title={abierta ? 'Ocultar leyenda' : 'Ver leyenda de turnos'}
        aria-expanded={abierta}
      >
        <Palette size={13} />
        {abierta ? <ChevronUp size={12} /> : <><span>Leyenda · {total}</span><ChevronDown size={12} /></>}
      </button>
      {abierta && (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          {grupos.map((g) => (
            <div key={g.titulo} className="inline-flex flex-wrap items-center gap-1" data-leyenda-grupo={g.titulo}>
              <span className="text-[9px] font-black uppercase text-slate-400">{g.titulo}</span>
              {g.chips.map((c) => (
                <span
                  key={`${g.titulo}-${c.code}`}
                  className={`inline-flex items-center gap-1 rounded px-1 py-px text-[9px] font-black ${ROJO.has(c.code) ? 'bg-red-600 text-white' : estilo(c.code) || 'bg-slate-100 text-slate-700'}`}
                  title={[c.code, c.detalle, c.horario, c.horas ? `${c.horas} h` : ''].filter(Boolean).join(' · ')}
                  data-leyenda-chip={c.code}
                >
                  {c.code}
                  {c.horario ? <span className="font-mono font-bold opacity-80">{c.horario.replace(/:00/g, '')}</span> : null}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
