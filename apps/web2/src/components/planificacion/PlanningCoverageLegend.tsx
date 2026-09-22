import React from 'react';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';

const OPS_RING = 'ring-2 ring-orange-400 ring-offset-1 dark:ring-offset-slate-900';

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

type PlanningCoverageLegendProps = {
    open: boolean;
    onToggle: () => void;
};

export function PlanningCoverageLegend({ open, onToggle }: PlanningCoverageLegendProps) {
    return (
        <div className="mx-2 mb-1 shrink-0 no-print">
            <button
                type="button"
                onClick={onToggle}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
            >
                <HelpCircle size={14} className="text-indigo-500 shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-700 dark:text-slate-200">
                    Iconografía cobertura (CC + grilla)
                </span>
                <span className="text-[9px] font-bold text-slate-400 ml-1 hidden sm:inline">
                    {open ? 'Ocultar' : 'Mostrar leyenda'}
                </span>
                <span className="ml-auto text-slate-400">
                    {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </span>
            </button>
            {open && (
                <div className="mt-1 px-3 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
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
                </div>
            )}
        </div>
    );
}

const SHIFT_EXT = 'bg-red-600 text-white border-red-700 font-black shadow-sm';
