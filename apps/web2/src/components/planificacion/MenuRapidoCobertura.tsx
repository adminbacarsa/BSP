import React, { useEffect, useRef } from 'react';
import { ChevronLeft, Search, UserPlus, UnfoldHorizontal, PanelRightOpen } from 'lucide-react';
import { clampMenuEnViewport, type OpcionesMenuRapido } from '@/lib/planificacion/menuRapidoCobertura';

export type FilaMenuRapido = {
  id: string;
  nombre: string;
  detalle: string;
  tag?: string;
  disabled?: boolean;
  motivo?: string;
};

type Props = {
  x: number;
  y: number;
  opciones: OpcionesMenuRapido;
  paso: 'raiz' | 'asignar' | 'ext' | 'adel';
  filas: FilaMenuRapido[];
  fuera: FilaMenuRapido[];
  busqueda: string;
  extNombre?: string;
  puedeAplicar?: boolean;
  onBusqueda: (q: string) => void;
  onAsignar: () => void;
  onExtAdel: () => void;
  onAbrir: () => void;
  onElegir: (id: string) => void;
  onVolver: () => void;
  onAplicar: () => void;
  onClose: () => void;
};

function Lista({
  titulo,
  filas,
  onElegir,
}: {
  titulo: string;
  filas: FilaMenuRapido[];
  onElegir: (id: string) => void;
}) {
  if (!filas.length) return null;
  return (
    <div className="mt-2">
      <p className="px-1 text-[10px] font-black uppercase tracking-wide text-slate-400">{titulo}</p>
      <ul className="mt-1 max-h-44 overflow-y-auto rounded-xl border border-slate-200">
        {filas.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              disabled={f.disabled}
              onClick={() => onElegir(f.id)}
              className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-2.5 py-1.5 text-left last:border-0 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-white disabled:text-slate-400"
              data-menu-fila={f.id}
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-black text-slate-800">{f.nombre}</span>
                <span className="block truncate text-[10px] font-medium text-slate-500">{f.disabled ? f.motivo : f.detalle}</span>
              </span>
              {f.tag ? (
                <span className="shrink-0 rounded-md border border-slate-200 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-600">{f.tag}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MenuRapidoCobertura({
  x,
  y,
  opciones,
  paso,
  filas,
  fuera,
  busqueda,
  extNombre,
  puedeAplicar,
  onBusqueda,
  onAsignar,
  onExtAdel,
  onAbrir,
  onElegir,
  onVolver,
  onAplicar,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const pos = clampMenuEnViewport(x, y, 320, paso === 'raiz' ? 220 : 460, vw, vh);

  return (
    <div
      ref={ref}
      role="menu"
      data-menu-rapido={paso}
      data-menu-clase={opciones.clase}
      className="fixed z-[10000] w-[320px] rounded-2xl border border-slate-200 bg-white p-3 shadow-lg"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="mb-2 flex items-center gap-1">
        {paso !== 'raiz' ? (
          <button type="button" onClick={onVolver} className="rounded-lg p-1 text-slate-500 hover:bg-slate-50" aria-label="Volver">
            <ChevronLeft size={16} />
          </button>
        ) : null}
        <p className="text-sm font-black text-slate-800">{opciones.titulo}</p>
      </div>

      {paso === 'raiz' && (
        <div className="flex flex-col gap-1.5">
          {opciones.asignar && (
            <button type="button" onClick={onAsignar} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-black text-slate-800 hover:bg-slate-50" data-menu-accion="asignar">
              <UserPlus size={14} className="text-indigo-600" /> Asignar a…
            </button>
          )}
          {opciones.extAdel && (
            <button type="button" onClick={onExtAdel} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-black text-slate-800 hover:bg-slate-50" data-menu-accion="ext">
              <UnfoldHorizontal size={14} className="text-indigo-600" /> Ext / Adel
            </button>
          )}
          {opciones.abrirCompleta && (
            <button type="button" onClick={onAbrir} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-black text-slate-800 hover:bg-slate-50" data-menu-accion="completa">
              <PanelRightOpen size={14} className="text-indigo-600" /> {opciones.soloLectura ? 'Abrir cobertura (solo lectura)…' : 'Abrir cobertura completa…'}
            </button>
          )}
        </div>
      )}

      {paso === 'asignar' && (
        <div>
          <Lista titulo="En el cronograma de hoy" filas={filas} onElegir={onElegir} />
          <div className="relative mt-2">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm font-bold outline-none focus:border-indigo-400"
              placeholder="Buscar fuera del cronograma"
              value={busqueda}
              onChange={(e) => onBusqueda(e.target.value)}
              data-menu-buscar
            />
          </div>
          <Lista titulo="Fuera del cronograma" filas={fuera} onElegir={onElegir} />
          {!filas.length && !fuera.length ? (
            <p className="mt-2 text-[11px] font-medium text-slate-500">Nadie disponible para asignar directo. El franco y los eventuales se cubren desde el modal.</p>
          ) : null}
        </div>
      )}

      {paso === 'ext' && (
        <div>
          <p className="text-[11px] font-medium text-slate-500">Elegí a quién extender (banda anterior, mismo puesto primero).</p>
          <Lista titulo="Extender" filas={filas} onElegir={onElegir} />
          {!filas.length ? <p className="mt-2 text-[11px] font-medium text-slate-500">No hay turnos en la banda anterior.</p> : null}
        </div>
      )}

      {paso === 'adel' && (
        <div>
          <p className="text-[11px] font-medium text-slate-500">Extensión: {extNombre || '—'}. Elegí a quién adelantar.</p>
          <Lista titulo="Adelantar" filas={filas} onElegir={onElegir} />
          <button
            type="button"
            disabled={!puedeAplicar}
            onClick={onAplicar}
            className="mt-2 w-full rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:border disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
            data-menu-accion="aplicar-split"
          >
            Aplicar Ext + Adel
          </button>
        </div>
      )}
    </div>
  );
}

/** Celda de la grilla con la marca del atajo, para la captura (el tooltip queda visible). */
export function CeldaMarcaMenuRapido({ codigo, tooltip }: { codigo: string; tooltip: string }) {
  return (
    <div className="inline-flex flex-col items-start gap-2" data-marca-menu>
      <div className="relative flex h-8 w-10 items-center justify-center rounded bg-rose-50 text-[10px] font-black text-rose-700">
        {codigo}
        <span className="absolute -bottom-0.5 left-0 rounded bg-orange-500 px-0.5 text-[7px] font-black text-white">✓</span>
      </div>
      <div className="max-w-xs rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-[11px] font-bold text-white shadow-lg" role="tooltip">
        {tooltip}
      </div>
    </div>
  );
}
