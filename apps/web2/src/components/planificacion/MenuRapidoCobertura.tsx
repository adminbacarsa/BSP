import React, { useEffect } from 'react';
import { AlertTriangle, PanelRightOpen, Repeat, Search, UnfoldHorizontal, UserPlus, X } from 'lucide-react';
import { clampMenuEnViewport, type OpcionesMenuRapido } from '@/lib/planificacion/menuRapidoCobertura';

type MenuProps = {
  x: number;
  y: number;
  opciones: OpcionesMenuRapido;
  onAsignar: () => void;
  onExtAdel: () => void;
  onAbrir: () => void;
  onClose: () => void;
};

function useEscape(onEscape: () => void, activo = true) {
  useEffect(() => {
    if (!activo) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onEscape, activo]);
}

/** Menú de clic derecho: dos acciones y, abajo, el modal completo. */
export default function MenuRapidoCobertura({ x, y, opciones, onAsignar, onExtAdel, onAbrir, onClose }: MenuProps) {
  useEscape(onClose);
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const pos = clampMenuEnViewport(x, y, 240, 150, vw, vh);

  return (
    <div
      role="menu"
      data-menu-rapido="raiz"
      data-menu-clase={opciones.clase}
      className="fixed z-[10000] w-[240px] rounded-2xl border border-slate-200 bg-white p-2 shadow-lg"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <p className="px-2 pb-1.5 pt-1 text-[11px] font-black uppercase tracking-wide text-slate-500">{opciones.titulo}</p>
      {opciones.asignar && (
        <button type="button" role="menuitem" onClick={onAsignar} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm font-black text-slate-800 hover:bg-slate-50" data-menu-accion="asignar">
          <UserPlus size={15} className="text-indigo-600" /> Asignar a…
        </button>
      )}
      {opciones.extAdel && (
        <button type="button" role="menuitem" onClick={onExtAdel} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm font-black text-slate-800 hover:bg-slate-50" data-menu-accion="ext">
          <UnfoldHorizontal size={15} className="text-indigo-600" /> Ext / Adel
        </button>
      )}
      {opciones.abrirCompleta && (
        <button
          type="button"
          role="menuitem"
          onClick={onAbrir}
          className={`mt-1 flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[11px] font-bold text-slate-500 hover:bg-slate-50 ${opciones.asignar || opciones.extAdel ? 'border-t border-slate-100' : ''}`}
          data-menu-accion="completa"
        >
          <PanelRightOpen size={12} /> {opciones.soloLectura ? 'Abrir cobertura (solo lectura)…' : 'Abrir cobertura completa…'}
        </button>
      )}
    </div>
  );
}

export type FilaFuera = { id: string; nombre: string };

type FranjaProps = {
  texto: string;
  aviso?: string | null;
  /** Solo Asignar a. */
  fueraVisible: boolean;
  fueraAbierto: boolean;
  busqueda: string;
  fuera: FilaFuera[];
  repetir?: { texto: string } | null;
  /** Ya se aplicó: queda el resumen con lo salteado y el botón Listo. */
  terminado?: boolean;
  onBusqueda: (q: string) => void;
  onToggleFuera: () => void;
  onElegirFuera: (id: string) => void;
  onRepetir: () => void;
  onCancelar: () => void;
};

/** Franja fija arriba de la grilla mientras se elige a la persona tocándola. */
export function FranjaModoElegir({
  texto,
  aviso,
  fueraVisible,
  fueraAbierto,
  busqueda,
  fuera,
  repetir,
  terminado,
  onBusqueda,
  onToggleFuera,
  onElegirFuera,
  onRepetir,
  onCancelar,
}: FranjaProps) {
  useEscape(onCancelar);
  return (
    <div
      className="fixed left-1/2 top-3 z-[9990] w-[min(880px,calc(100vw-24px))] -translate-x-1/2 rounded-2xl border border-indigo-200 bg-white px-4 py-2.5 shadow-lg"
      data-franja-elegir
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-indigo-600" />
        <p className="min-w-0 flex-1 text-sm font-black text-slate-800" data-franja-texto>{texto}</p>
        {fueraVisible && !repetir && !terminado && (
          <button
            type="button"
            onClick={onToggleFuera}
            className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-600 hover:bg-slate-50"
            data-franja-fuera
          >
            <Search size={12} /> Buscar fuera del cronograma
          </button>
        )}
        {repetir && (
          <button
            type="button"
            onClick={onRepetir}
            className="flex shrink-0 items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-indigo-700"
            data-franja-repetir
          >
            <Repeat size={12} /> {repetir.texto}
          </button>
        )}
        <button
          type="button"
          onClick={onCancelar}
          className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-600 hover:bg-slate-50"
          data-franja-cancelar
        >
          <X size={12} /> {repetir || terminado ? 'Listo' : 'Cancelar'}
        </button>
      </div>
      {aviso ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-amber-700" data-franja-aviso>
          <AlertTriangle size={13} /> {aviso}
        </p>
      ) : null}
      {fueraVisible && fueraAbierto && !repetir && !terminado && (
        <div className="mt-2 rounded-xl border border-slate-200 p-2">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-sm font-bold outline-none focus:border-indigo-400"
              placeholder="Legajo activo sin turno ni licencia ese día"
              value={busqueda}
              onChange={(e) => onBusqueda(e.target.value)}
              data-franja-buscar
            />
          </div>
          <ul className="mt-1.5 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
            {fuera.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onElegirFuera(f.id)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-black text-slate-700 hover:bg-indigo-50"
                  data-franja-fuera-fila={f.id}
                >
                  {f.nombre}
                </button>
              </li>
            ))}
            {!fuera.length ? <li className="text-[11px] font-medium text-slate-500">Nadie libre fuera del cronograma.</li> : null}
          </ul>
        </div>
      )}
    </div>
  );
}
