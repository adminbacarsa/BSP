import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Briefcase, Clock, MapPin, Siren, Stethoscope, X } from 'lucide-react';
import { IndicadorConsultaCelda } from '@/components/planificacion/ConsultasEnCurso';
import { ubicarTooltipCelda } from '@/lib/planificacion/coberturaDiaHueco';

/** El tooltip de la celda sale solo si el mouse queda quieto este tiempo sobre la misma celda. */
export const CELL_TOOLTIP_DELAY_MS = 2000;

/** Lo que pinta una celda: solo primitivos, para que `React.memo` compare por valor. */
export type VistaCelda = {
    key: string;
    contenido: string | number | null | undefined;
    borrado: boolean;
    estilo: string;
    sufijoUsado: string;
    ringExtra: string;
    editable: boolean;
    fondo: string;
    evento?: string;
    titulo?: string;
    consulta: boolean;
    consultaId?: string;
    consultaTexto?: string;
    consultaTooltip?: string;
    evBadge: boolean;
    evBadgeTitulo?: string;
    lct?: string;
    puntoExclusion: boolean;
    swap: '' | 'S' | 'S!';
    mas: boolean;
    liberado: boolean;
    usado: boolean;
    descansoReducido: boolean;
    topeExcedido: boolean;
    /** Borde rojo desde el día en que el mes pasa 200 h. No tapa el código. */
    marcaTope: boolean;
    menuRol?: string;
    menuMarca?: string;
    cubiertoTitulo?: string;
    estado?: string;
    conflicto: boolean;
    invitado: boolean;
    otroObjetivo: boolean;
    grupoColor?: string;
    grupoNombre?: string;
    rfzOverlay: boolean;
    rfzSinPublicar: boolean;
};

/** Devuelve la vista anterior si no cambió nada: así la celda no se vuelve a renderizar. */
export function reusarVista(prev: VistaCelda | undefined, next: VistaCelda): VistaCelda {
    if (!prev) return next;
    const a = prev as Record<string, unknown>;
    const b = next as Record<string, unknown>;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return next;
    for (const k of kb) if (a[k] !== b[k]) return next;
    return prev;
}

/** Handlers de la grilla: el padre reemplaza `current` en cada render y las celdas memoizadas leen lo último. */
export type ControlCeldas = {
    contextMenu: (ev: React.MouseEvent, key: string) => void;
    mouseDown: (ev: React.MouseEvent, key: string, fila: number, col: number) => void;
    mouseEnter: (ev: React.MouseEvent, key: string, fila: number, col: number) => void;
    mouseMove: (ev: React.MouseEvent) => void;
    mouseLeave: () => void;
    abrirConsulta: (consultaId: string) => void;
};

type PropsCelda = {
    vista: VistaCelda;
    fila: number;
    col: number;
    seleccionada: boolean;
    colElegir: boolean;
    elegirActivo: boolean;
    comparada: boolean;
    ctl: React.MutableRefObject<ControlCeldas>;
};

function CeldaGrillaBase({ vista: v, fila, col, seleccionada, colElegir, elegirActivo, comparada, ctl }: PropsCelda) {
    const contenidoVisible = v.borrado || !!v.contenido;
    return (
        <td
            data-testid="grilla-celda"
            data-rc={`${fila}:${col}`}
            onContextMenu={(ev) => ctl.current.contextMenu(ev, v.key)}
            onMouseDown={(ev) => ctl.current.mouseDown(ev, v.key, fila, col)}
            onMouseEnter={(ev) => ctl.current.mouseEnter(ev, v.key, fila, col)}
            onMouseMove={(ev) => ctl.current.mouseMove(ev)}
            onMouseLeave={() => ctl.current.mouseLeave()}
            data-modo-elegir-col={colElegir ? '1' : undefined}
            data-marca-tope={v.marcaTope ? '1' : undefined}
            className={`border-b border-r p-0.5 ${elegirActivo || v.editable ? 'cursor-pointer' : 'cursor-default'} text-center relative ${colElegir ? 'bg-indigo-100 dark:bg-indigo-900/40' : seleccionada ? 'bg-indigo-200 dark:bg-indigo-800/50' : v.fondo}`}
            data-evento={v.evento}
            title={v.titulo}
        >
            <div className={`w-full h-6 rounded flex items-center justify-center text-[9px] font-black relative ${v.estilo}${comparada ? ' ring-2 ring-violet-600 ring-offset-1 z-20' : ''}${v.sufijoUsado} ${v.ringExtra}${v.marcaTope ? ' border-b-2 border-rose-600' : ''}${v.descansoReducido ? ' border-t-2 border-amber-500' : ''}`}>
                {v.consulta ? (
                    <IndicadorConsultaCelda
                        texto={v.consultaTexto || ''}
                        tooltip={v.consultaTooltip || ''}
                        onAbrir={() => ctl.current.abrirConsulta(v.consultaId as string)}
                    />
                ) : null}
                {v.evBadge && (
                    <div className="absolute -bottom-0.5 right-0 text-[6.5px] font-black bg-yellow-400 text-yellow-900 px-0.5 rounded z-10">EV</div>
                )}
                {v.lct ? (<span className="absolute top-0 left-0 w-1.5 h-1.5 rounded-full bg-amber-500 border border-white" title={v.evento ? undefined : v.lct} />) : null}
                {v.borrado ? <X size={12} /> : v.contenido}
                {v.puntoExclusion && (<span className="absolute bottom-0 left-0 w-1.5 h-1.5 rounded-full bg-rose-400/80" title="Día con puesto(s) excluido(s)" />)}
                {v.swap && (
                    <div className={`absolute bottom-0.5 right-0.5 text-[8px] font-black px-1 rounded ${v.swap === 'S!' ? 'bg-amber-600 text-white' : 'bg-cyan-600 text-white'}`}>{v.swap}</div>
                )}
                {v.mas && <div className="absolute -top-1 -right-1 text-[8px] bg-red-900 text-white px-1 rounded-full border border-white/40">+</div>}
                {v.liberado && <div className="absolute -bottom-0.5 left-0 text-[7px] font-black bg-emerald-600 text-white px-0.5 rounded">RET</div>}
                {v.usado && <div className="absolute -top-1 -left-1 text-[7px] font-black bg-violet-600 text-white px-0.5 rounded z-10" title="Turno usado en cobertura operativa">U</div>}
                {v.menuRol ? (
                    <div className={`absolute -top-1 left-1/2 -translate-x-1/2 max-w-full truncate text-[6.5px] font-black text-white px-0.5 rounded z-10 ${v.menuRol === 'CUBRE' ? 'bg-indigo-600' : 'bg-emerald-600'}`} data-marca-menu={v.menuRol}>{v.menuMarca}</div>
                ) : null}
                {v.cubiertoTitulo != null && <div className="absolute -bottom-0.5 left-0 text-[7px] font-black bg-orange-500 text-white px-0.5 rounded" title={v.cubiertoTitulo}>✓</div>}
                {v.estado && <div className={`absolute top-0 right-0 w-2 h-2 rounded-full border border-white ${v.estado}`}></div>}
                {v.conflicto && (
                    <div className="absolute inset-0 flex items-center justify-center z-20 ring-2 ring-amber-300 ring-inset bg-slate-900/45" data-conflicto-celda><Siren size={14} className="text-amber-200 drop-shadow-md" /></div>
                )}
                {v.invitado && (<div className="absolute bottom-0 left-0"><Briefcase size={8} className="text-amber-600 drop-shadow-sm" /></div>)}
                {v.otroObjetivo && contenidoVisible && (<div className="absolute bottom-0 left-0"><MapPin size={7} className="text-slate-300 drop-shadow-sm" /></div>)}
                {v.grupoColor ? (
                    <>
                        <div className="absolute top-0 left-0 bottom-0 w-0.5 opacity-80" style={{ backgroundColor: v.grupoColor }} />
                        <div className="absolute bottom-0 left-0.5 right-0 text-[5.5px] font-black text-white leading-tight text-center overflow-hidden" style={{ backgroundColor: v.grupoColor + 'cc' }}>{v.grupoNombre}</div>
                    </>
                ) : null}
                {v.rfzOverlay && (<div className="absolute top-0 right-0 text-[7px] font-black bg-red-600 text-white px-0.5 rounded-bl">RFZ</div>)}
                {v.rfzSinPublicar && (<div className="absolute bottom-0 right-0 w-1.5 h-1.5 rounded-full bg-amber-400 border border-white" title="Sin publicar" />)}
            </div>
        </td>
    );
}

export const CeldaGrilla = React.memo(CeldaGrillaBase);

export type DatosTooltipCelda = {
    label: string | null;
    pos: string | null;
    range: string | null;
    restHours?: number | null;
    readOnlyOps?: boolean;
};

/** Control imperativo del tooltip: nada de esto toca el estado de la página. */
export type ControlTooltipCelda = {
    programar: (construir: () => DatosTooltipCelda | null, x: number, y: number) => void;
    mover: (x: number, y: number) => void;
    ocultar: () => void;
};

const CONTROL_VACIO: ControlTooltipCelda = { programar: () => {}, mover: () => {}, ocultar: () => {} };

export function useControlTooltipCelda(): React.MutableRefObject<ControlTooltipCelda> {
    return useRef<ControlTooltipCelda>(CONTROL_VACIO);
}

/** Un solo tooltip para toda la grilla, en un portal. El contenido se calcula recién al mostrarlo. */
export function TooltipCeldaGrilla({
    controlRef,
    demoraMs = CELL_TOOLTIP_DELAY_MS,
}: {
    controlRef: React.MutableRefObject<ControlTooltipCelda>;
    demoraMs?: number;
}) {
    const [datos, setDatos] = useState<(DatosTooltipCelda & { x: number; y: number }) | null>(null);
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let construir: (() => DatosTooltipCelda | null) | null = null;
        let pos = { x: 0, y: 0 };
        let visible = false;
        const limpiar = () => {
            if (timer) clearTimeout(timer);
            timer = null;
        };
        const esconder = () => {
            if (visible) {
                visible = false;
                setDatos(null);
            }
        };
        const arrancar = () => {
            limpiar();
            timer = setTimeout(() => {
                timer = null;
                const d = construir ? construir() : null;
                if (!d) return;
                visible = true;
                setDatos({ ...d, x: pos.x, y: pos.y });
            }, demoraMs);
        };
        controlRef.current = {
            programar: (fn, x, y) => {
                esconder();
                construir = fn;
                pos = { x, y };
                arrancar();
            },
            mover: (x, y) => {
                if (visible || !construir) return;
                pos = { x, y };
                arrancar();
            },
            ocultar: () => {
                limpiar();
                construir = null;
                esconder();
            },
        };
        return () => {
            limpiar();
            controlRef.current = CONTROL_VACIO;
        };
    }, [controlRef, demoraMs]);

    const cajaRef = useRef<HTMLDivElement>(null);
    const [caja, setCaja] = useState<{ left: number; top: number } | null>(null);
    useLayoutEffect(() => {
        const el = cajaRef.current;
        if (!datos || !el || typeof window === 'undefined') {
            setCaja(null);
            return;
        }
        const r = el.getBoundingClientRect();
        const next = ubicarTooltipCelda(datos.x, datos.y, r.width, r.height, window.innerWidth, window.innerHeight);
        setCaja((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next));
    }, [datos]);
    if (!datos || typeof document === 'undefined') return null;
    const estimado = ubicarTooltipCelda(datos.x, datos.y, 280, 110, window.innerWidth, window.innerHeight);
    return createPortal(
        <div
            ref={cajaRef}
            className="fixed z-[9999] pointer-events-none"
            style={{ left: (caja || estimado).left, top: (caja || estimado).top }}
            data-tooltip-celda
        >
            <div className={`bg-slate-900 text-white text-[10px] font-black px-2.5 py-2 rounded-lg shadow-sm flex flex-col gap-1 max-w-[320px] ${datos.label?.includes('\n') ? 'whitespace-pre-line' : 'whitespace-nowrap'}`}>
                {datos.label && (
                    <div className="flex items-start gap-1.5 text-white font-medium">
                        {datos.label.startsWith('Tipo:') ? (
                            <Stethoscope size={9} className="text-rose-300 shrink-0 mt-0.5" />
                        ) : (
                            <Clock size={9} className="text-indigo-300 shrink-0 mt-0.5" />
                        )}
                        <span>{datos.label}</span>
                    </div>
                )}
                {datos.pos && (
                    <div className="flex items-center gap-1.5 text-slate-300 font-medium text-[9px]">
                        <MapPin size={9} className="text-indigo-300 shrink-0" />
                        {datos.pos}
                    </div>
                )}
                {datos.range && (
                    <div className="flex items-center gap-1.5 text-slate-300 font-medium text-[9px]">
                        <span className="text-indigo-300">⏱</span>
                        {datos.range}
                    </div>
                )}
                {datos.restHours != null && (
                    <div className="flex items-center gap-1.5 text-green-300 font-medium text-[9px]">
                        <span className="text-green-400">⏸</span>
                        Descanso total: <span className="font-black text-green-200">{datos.restHours}h</span>
                    </div>
                )}
                <div className="text-[8px] text-slate-500 font-medium pt-0.5 border-t border-slate-700">
                    {datos.readOnlyOps
                        ? 'Solo lectura (Operaciones) — click en la celda para informe completo'
                        : 'Click para ver detalle / Cambiar'}
                </div>
            </div>
            <div className="w-2 h-2 bg-slate-900 rotate-45 ml-2 -mt-1" />
        </div>,
        document.body,
    );
}
