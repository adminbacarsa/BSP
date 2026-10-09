import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Layers } from 'lucide-react';
import { rotuloGrupoVista, type OpcionGrupoVista } from '@/lib/planificacion/grupoDesplegable';

type Props = {
  nombreGrupo: string;
  vistaAgrupada: boolean;
  nombreObjetivo?: string | null;
  opciones: OpcionGrupoVista[];
  onTodos: () => void;
  onObjetivo: (objectiveId: string) => void;
  onSalir: () => void;
};

export default function GrupoVistaDesplegable({
  nombreGrupo,
  vistaAgrupada,
  nombreObjetivo,
  opciones,
  onTodos,
  onObjetivo,
  onSalir,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [foco, setFoco] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const focoRef = useRef(0);
  const opcionesRef = useRef(opciones);
  opcionesRef.current = opciones;

  const rotulo = rotuloGrupoVista(nombreGrupo, vistaAgrupada, nombreObjetivo);

  const colocar = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(260, Math.min(320, r.width));
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ top: r.bottom + 6, left, width });
  };

  const activar = (op: OpcionGrupoVista | undefined) => {
    if (!op) return;
    setAbierto(false);
    if (op.id === 'todos') onTodos();
    else if (op.id === 'objetivo' && op.objectiveId) onObjetivo(op.objectiveId);
    else if (op.id === 'salir') onSalir();
  };

  useEffect(() => {
    if (!abierto) return;
    colocar();
    const lista = opcionesRef.current;
    const activa = lista.findIndex((o) => o.activa);
    const inicial = activa >= 0 ? activa : 0;
    focoRef.current = inicial;
    setFoco(inicial);
    const onScroll = (e: Event) => {
      const node = e.target;
      if (node instanceof Element && node.closest('[data-grupo-vista-menu]')) return;
      setAbierto(false);
    };
    const onKey = (e: KeyboardEvent) => {
      const ops = opcionesRef.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setAbierto(false);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const next = e.key === 'ArrowDown' ? focoRef.current + 1 : focoRef.current - 1;
        const i = Math.max(0, Math.min(ops.length - 1, next));
        focoRef.current = i;
        setFoco(i);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        activar(ops[focoRef.current]);
      }
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', colocar);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', colocar);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [abierto]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-grupo-vista
        aria-expanded={abierto}
        aria-haspopup="listbox"
        title={rotulo}
        onClick={(e) => {
          e.stopPropagation();
          setAbierto((v) => !v);
        }}
        className={`flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-black tracking-wide whitespace-nowrap shrink-0 max-w-[16rem] min-w-0 transition-colors ${vistaAgrupada ? 'bg-violet-700 text-white' : 'bg-white text-violet-700 border border-violet-400 hover:bg-violet-50'}`}
      >
        <Layers size={11} className="shrink-0" />
        <span className="truncate">{rotulo}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>
      {abierto && pos && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" aria-hidden onClick={() => setAbierto(false)} />
          <div
            data-grupo-vista-menu
            role="listbox"
            className="fixed z-[9999] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-2xl max-h-[min(70vh,320px)] overflow-y-auto"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            onClick={(e) => e.stopPropagation()}
          >
            {opciones.map((op, i) => (
              <button
                key={op.objectiveId || op.id}
                type="button"
                role="option"
                aria-selected={op.activa}
                data-grupo-opcion={op.objectiveId || op.id}
                data-grupo-foco={i === foco ? '1' : undefined}
                onMouseEnter={() => setFoco(i)}
                onClick={() => activar(op)}
                className={`w-full text-left px-3 py-2 border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors ${i === foco ? 'bg-violet-50 dark:bg-violet-900/20' : 'hover:bg-violet-50 dark:hover:bg-violet-900/20'} ${op.id === 'salir' ? 'text-rose-600' : ''}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-semibold truncate ${op.activa ? 'text-violet-700' : op.id === 'salir' ? 'text-rose-600' : 'text-slate-700 dark:text-slate-200'}`}>{op.nombre}</span>
                    <span className="block text-[10px] text-slate-400 truncate">{op.subtitulo}</span>
                  </span>
                  {op.activa ? <Check size={14} className="shrink-0 text-violet-600" /> : null}
                </span>
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
