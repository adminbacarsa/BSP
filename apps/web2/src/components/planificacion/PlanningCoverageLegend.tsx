import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, X } from 'lucide-react';

const OPS_RING = 'ring-2 ring-orange-400 ring-offset-1 dark:ring-offset-slate-900';
const POPOVER_ANCHO = 520;

type LegendItemProps = {
    sample: React.ReactNode;
    title: string;
    detail: string;
};

function LegendItem({ sample, title, detail }: LegendItemProps) {
    return (
        <div className="flex items-start gap-2 min-w-[140px] max-w-[220px]">
            <div className="shrink-0 w-8 h-6 flex items-center justify-center">{sample}</div>
            <div className="min-w-0">
                <p className="text-[9px] font-black text-slate-800 dark:text-slate-100 leading-tight">{title}</p>
                <p className="text-[8px] font-medium text-slate-500 dark:text-slate-400 leading-snug mt-0.5">{detail}</p>
            </div>
        </div>
    );
}

function MiniCell({
    code,
    className,
    children,
}: {
    code: string;
    className: string;
    children?: React.ReactNode;
}) {
    return (
        <div
            className={`relative w-full h-6 rounded flex items-center justify-center text-[9px] font-black ${className}`}
        >
            {code}
            {children}
        </div>
    );
}

function LeyendaCobertura() {
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-3">
            <LegendItem
                sample={
                    <MiniCell
                        code="T"
                        className={`bg-white text-orange-600 border border-orange-400 ${OPS_RING}`}
                    />
                }
                title="Reemplazo desde Operaciones"
                detail="Otro guardia cubrió ausencia/hueco. Anillo naranja, solo lectura en crono publicado."
            />
            <LegendItem
                sample={
                    <MiniCell code="M" className={SHIFT_EXT}>
                        <div className="absolute -top-1 -right-1 text-[7px] bg-red-900 text-white px-0.5 rounded-full border border-white/40">
                            +
                        </div>
                    </MiniCell>
                }
                title="Extensión o adelanto"
                detail="El mismo guardia suma horas (8→12 o ingreso antes). Fondo rojo y «+»."
            />
            <LegendItem
                sample={
                    <MiniCell code="D12" className={SHIFT_EXT}>
                        <div className="absolute -top-1 -right-1 text-[7px] bg-red-900 text-white px-0.5 rounded-full border border-white/40">
                            +
                        </div>
                    </MiniCell>
                }
                title="Jornada 12 h por extensión"
                detail="Tras ext. CC el código pasa a D12/N12 con el mismo estilo rojo."
            />
            <LegendItem
                sample={
                    <MiniCell code="E" className="bg-white text-rose-700 border border-rose-400 font-black">
                        <div className="absolute top-0 right-0 w-2 h-2 rounded-full border border-white bg-teal-500" />
                    </MiniCell>
                }
                title="Ausente ya cubierto"
                detail="Titular con licencia/ausencia; punto teal = CC cerró la cobertura."
            />
            <LegendItem
                sample={
                    <MiniCell code="V" className="bg-emerald-700 text-white border border-emerald-800 font-black">
                        <div className="absolute -bottom-0.5 left-0 text-[7px] font-black bg-orange-500 text-white px-0.5 rounded">
                            ✓
                        </div>
                    </MiniCell>
                }
                title="Licencia con reemplazo"
                detail="✓ naranja abajo: hay suplente asignado (plan o CC)."
            />
            <LegendItem
                sample={
                    <div className="flex flex-col gap-0.5 items-center justify-center h-6">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 border border-white" title="Presente" />
                        <div className="w-2 h-2 rounded-full bg-rose-500 border border-white" title="Ausente sin cubrir" />
                    </div>
                }
                title="Estado ops (punto)"
                detail="Verde = presente · Rojo = ausente sin cubrir (crono publicado)."
            />
        </div>
    );
}

/** Botón de la barra superior: abre la iconografía de cobertura en un popover. */
export function PlanningCoverageLegend() {
    const [abierta, setAbierta] = useState(false);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const botonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const ubicar = () => {
        const r = botonRef.current?.getBoundingClientRect();
        if (!r) return;
        const ancho = Math.min(POPOVER_ANCHO, window.innerWidth - 16);
        const left = Math.max(8, Math.min(r.right - ancho, window.innerWidth - ancho - 8));
        setPos({ top: r.bottom + 6, left });
    };

    useEffect(() => {
        if (!abierta) return;
        ubicar();
        const alClic = (ev: MouseEvent) => {
            const t = ev.target as Node;
            if (panelRef.current?.contains(t) || botonRef.current?.contains(t)) return;
            setAbierta(false);
        };
        const alTecla = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') setAbierta(false);
        };
        window.addEventListener('mousedown', alClic);
        window.addEventListener('keydown', alTecla);
        window.addEventListener('resize', ubicar);
        return () => {
            window.removeEventListener('mousedown', alClic);
            window.removeEventListener('keydown', alTecla);
            window.removeEventListener('resize', ubicar);
        };
    }, [abierta]);

    return (
        <>
            <button
                ref={botonRef}
                type="button"
                onClick={() => setAbierta((v) => !v)}
                className={`p-2 rounded-xl transition-colors border shrink-0 no-print ${abierta ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-slate-100 border-transparent hover:bg-white text-slate-500'}`}
                title="Iconografía de cobertura"
                aria-label="Iconografía de cobertura"
                aria-expanded={abierta}
                data-leyenda-cobertura-btn
            >
                <HelpCircle size={18} />
            </button>
            {abierta && pos && typeof document !== 'undefined' && createPortal(
                <div
                    ref={panelRef}
                    className="fixed z-[9998] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg no-print"
                    style={{ top: pos.top, left: pos.left, width: Math.min(POPOVER_ANCHO, window.innerWidth - 16) }}
                    role="dialog"
                    aria-label="Iconografía de cobertura"
                    data-leyenda-cobertura
                >
                    <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 border-b border-slate-100 dark:border-slate-800">
                        <HelpCircle size={14} className="text-indigo-500 shrink-0" />
                        <span className="text-[10px] font-black uppercase tracking-wide text-slate-700 dark:text-slate-200">
                            Iconografía cobertura (CC + grilla)
                        </span>
                        <button
                            type="button"
                            onClick={() => setAbierta(false)}
                            className="ml-auto p-1 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 dark:hover:bg-slate-800"
                            aria-label="Cerrar"
                        >
                            <X size={14} />
                        </button>
                    </div>
                    <div className="px-3 py-3">
                        <LeyendaCobertura />
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}

const SHIFT_EXT = 'bg-red-600 text-white border-red-700 font-black shadow-sm';
