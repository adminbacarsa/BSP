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
  colorPuesto,
  filtro,
  onFiltro,
}: {
  puestos: readonly { name: string; shifts: readonly TurnoLeyenda[] }[];
  usados: ReadonlySet<string>;
  abierta: boolean;
  onToggle: () => void;
  estilo: (code: string) => string;
  sinMarco?: boolean;
  /** Color de cada puesto en la grilla (borde de la celda): la referencia lo repite. */
  colorPuesto?: Record<string, { color: string; sigla?: string }>;
  /** Filtro activo: solo ese puesto (y ese turno). `puesto` vacío = un código de «Otros» (F, RET…). */
  filtro?: { puesto: string; code?: string } | null;
  onFiltro?: (f: { puesto: string; code?: string } | null) => void;
}) {
  const esPuesto = (titulo: string) => !!puestos.find((p) => p.name.trim().toUpperCase() === titulo.trim().toUpperCase());
  const activo = (puesto: string, code?: string) => !!filtro
    && filtro.puesto.trim().toUpperCase() === puesto.trim().toUpperCase()
    && (filtro.code || '') === (code || '');
  const alternar = (puesto: string, code?: string) => {
    if (!onFiltro) return;
    onFiltro(activo(puesto, code) ? null : { puesto, ...(code ? { code } : {}) });
  };
  const colorDe = (titulo: string) => {
    if (!colorPuesto) return undefined;
    const k = Object.keys(colorPuesto).find((n) => n.trim().toUpperCase() === titulo.trim().toUpperCase());
    return k ? colorPuesto[k].color : undefined;
  };
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
      {filtro && onFiltro && (
        <button
          type="button"
          onClick={() => onFiltro(null)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-indigo-600 px-1.5 py-0.5 text-[10px] font-black text-white hover:bg-indigo-700"
          title="Mostrar todos los turnos"
          data-leyenda-filtro-quitar
        >
          Solo {filtro.puesto || ''}{filtro.code ? `${filtro.puesto ? ' · ' : ''}${filtro.code}` : ''} ✕
        </button>
      )}
      {abierta && (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          {grupos.map((g) => {
            const color = colorDe(g.titulo);
            const puesto = esPuesto(g.titulo) ? g.titulo : '';
            return (
            <div key={g.titulo} className="inline-flex flex-wrap items-center gap-1" data-leyenda-grupo={g.titulo}>
              <span
                role={puesto && onFiltro ? 'button' : undefined}
                onClick={puesto ? () => alternar(puesto) : undefined}
                className={`text-[9px] font-black uppercase ${color ? 'rounded px-1 py-px text-white' : 'text-slate-400'} ${puesto && onFiltro ? 'cursor-pointer hover:opacity-80' : ''} ${puesto && activo(puesto) ? 'ring-2 ring-indigo-600 ring-offset-1' : ''}`}
                style={color ? { backgroundColor: color } : undefined}
                data-leyenda-puesto-color={color || undefined}
                data-leyenda-filtro-puesto={puesto || undefined}
                title={puesto && onFiltro ? (activo(puesto) ? 'Mostrar todos' : `Ver solo los turnos de ${puesto}`) : undefined}
              >
                {g.titulo}
              </span>
              {g.chips.map((c) => (
                <span
                  key={`${g.titulo}-${c.code}`}
                  style={color && !ROJO.has(c.code) ? { backgroundColor: '#fff', color: '#0f172a', borderColor: color, borderWidth: 2, borderStyle: 'solid' } : undefined}
                  className={`inline-flex items-center gap-1 rounded px-1 py-px text-[9px] font-black ${onFiltro ? 'cursor-pointer hover:opacity-80' : ''} ${activo(puesto, c.code) ? 'ring-2 ring-indigo-600 ring-offset-1' : ''} ${ROJO.has(c.code) ? 'bg-red-600 text-white' : color ? '' : estilo(c.code) || 'bg-slate-100 text-slate-700'}`}
                  title={[c.code, c.detalle, c.horario, c.horas ? `${c.horas} h` : ''].filter(Boolean).join(' · ') + (onFiltro ? (activo(puesto, c.code) ? ' · clic: mostrar todos' : ' · clic: ver solo estos') : '')}
                  data-leyenda-chip={c.code}
                  role={onFiltro ? 'button' : undefined}
                  onClick={onFiltro ? () => alternar(puesto, c.code) : undefined}
                >
                  {c.code}
                  {c.horario ? <span className="font-mono font-bold opacity-80">{c.horario.replace(/:00/g, '')}</span> : null}
                </span>
              ))}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
