import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardPaste, Keyboard, Search, X } from 'lucide-react';
import { agruparAvisos, ATAJOS_MODO_RAPIDO, idAviso, idGrupoAviso, textoDiaE, textoResumenPegado, type AvisoRapido, type FilaPegadoExcel, type GuardiaPegado, type PreviewPegadoExcel, type TipoNovedadRapida } from '@/lib/planificacion/modoRapido';
import { clasificarPegado, indicesAsignados, sinEncontrarVisibles, textoGruposPegado, textoPlataforma } from '@/lib/planificacion/pegarPersonas';
import { equivalenciaDeDefinicion, proponerDefinicion, textoCeldasVacias } from '@/lib/planificacion/definirCodigo';
import { cambiosHorarioServicio } from '@/lib/planificacion/codigosHorarioPegado';
import { TEXTO_PIN_AVISOS, ubicarCierre12, type Caja } from '@/lib/planificacion/panelesPlanif';

export function ModoRapidoAyuda({ onCerrar }: { onCerrar: () => void }) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            onCerrar();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onCerrar]);
    if (typeof document === 'undefined') return null;
    return createPortal(
        <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onCerrar} data-modo-rapido-ayuda>
            <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
                <div className="mb-2 flex items-center gap-2">
                    <Keyboard size={16} className="text-indigo-600" />
                    <p className="text-xs font-black uppercase text-slate-800">Modo rápido · atajos</p>
                    <button type="button" onClick={onCerrar} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600" aria-label="Cerrar"><X size={14} /></button>
                </div>
                <p className="mb-2 text-[11px] text-slate-500">Hacé clic en una celda y escribí. Nada frena mientras cargás: los avisos quedan marcados y el PIN se pide al publicar.</p>
                <p className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-[11px] font-medium text-indigo-900" data-modo-rapido-ayuda-pegar>
                    Para pegar desde Excel: copiá desde la columna del nombre hasta el último día y apretá Ctrl+V en la grilla. Desde Excel se lee el color: M y N rojas pasan a D12 y N12 y la E amarilla es evento (se vincula a un evento cargado o queda «Afectado a evento»). Si el color no viaja, la E se pregunta en el resumen y las de 12 h se escriben D12 y N12, o con + si falta una banda.
                </p>
                <ul className="space-y-1">
                    {ATAJOS_MODO_RAPIDO.map((a) => (
                        <li key={a.teclas} className="flex gap-2 text-[11px]">
                            <span className="w-[148px] shrink-0 font-black text-slate-700">{a.teclas}</span>
                            <span className="text-slate-600">{a.que}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>,
        document.body,
    );
}

const ETIQUETA: Record<AvisoRapido['tipo'], string> = {
    DESCANSO: 'Descanso',
    TOPE: 'Tope',
    LICENCIA: 'Licencia',
    SOLAPE: 'Solape',
    SERVICIO: 'Fuera del servicio',
    SOBRECOBERTURA: 'Sobrecobertura',
    SIN_PUESTO: 'Sin puesto',
    COPIA: 'Puesto',
};
const COLOR: Record<AvisoRapido['tipo'], string> = {
    DESCANSO: 'bg-amber-500',
    TOPE: 'bg-rose-500',
    LICENCIA: 'bg-fuchsia-500',
    SOLAPE: 'bg-orange-500',
    SERVICIO: 'bg-slate-600',
    SOBRECOBERTURA: 'bg-amber-600',
    SIN_PUESTO: 'bg-slate-500',
    COPIA: 'bg-indigo-500',
};

export function ModoRapidoAvisosPanel({
    avisos,
    sinServicio,
    onIr,
    onVisto,
    onAsignarPuesto,
}: {
    /** Solo los que no se marcaron como vistos. */
    avisos: AvisoRapido[];
    sinServicio: boolean;
    onIr: (a: AvisoRapido) => void;
    onVisto: (ids: string[]) => void;
    onAsignarPuesto?: (a: AvisoRapido) => void;
}) {
    const grupos = useMemo(() => agruparAvisos(avisos), [avisos]);
    const [desplegado, setDesplegado] = useState<string | null>(null);
    return (
        <div data-modo-rapido-avisos={avisos.length}>
            <div className="px-1 py-1">
                {sinServicio && (
                    <p className="px-1 pb-1.5 text-[10px] font-bold text-slate-500">Sin servicio: no se valida cobertura.</p>
                )}
                {grupos.length === 0 && <p className="px-1 py-1 text-[11px] text-slate-400">Sin avisos.</p>}
                {grupos.map((g) => {
                    const abiertoGrupo = desplegado === g.clave;
                    return (
                        <div key={g.clave}>
                            <div className="flex flex-wrap items-start gap-1 rounded-lg hover:bg-slate-50">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (g.items.length === 1) onIr(g.items[0]);
                                        else setDesplegado(abiertoGrupo ? null : g.clave);
                                    }}
                                    className="flex min-w-0 flex-1 items-start gap-2 px-1.5 py-1 text-left"
                                    data-aviso-grupo={g.empId}
                                >
                                    <span className={`mt-0.5 shrink-0 rounded px-1 text-[8px] font-black uppercase text-white ${COLOR[g.tipo]}`}>{ETIQUETA[g.tipo]}</span>
                                    <span className="min-w-0 break-words text-[11px] leading-snug text-slate-700">{g.texto}</span>
                                </button>
                                {g.tipo === 'SIN_PUESTO' && g.items[0]?.puestoSugerido && onAsignarPuesto && (
                                    <button
                                        type="button"
                                        onClick={() => onAsignarPuesto(g.items[0])}
                                        className="mt-0.5 shrink-0 rounded-lg border border-indigo-200 px-1.5 py-0.5 text-[10px] font-black text-indigo-700 hover:bg-indigo-50"
                                        data-aviso-asignar-puesto={g.items[0].puestoSugerido}
                                    >
                                        Asignar {g.items[0].puestoSugerido}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => onVisto(g.items.map(idAviso))}
                                    className="mt-0.5 shrink-0 rounded-md p-1 text-slate-300 hover:bg-white hover:text-slate-600"
                                    title="Visto: deja de mostrarse acá. La marca de la celda sigue. El PIN se pide al publicar."
                                    aria-label="Marcar como visto"
                                    data-aviso-visto={idGrupoAviso(g)}
                                >
                                    <X size={12} />
                                </button>
                            </div>
                            {abiertoGrupo && g.items.length > 1 && (
                                <div className="mb-1 ml-8 flex flex-wrap gap-1">
                                    {g.items.map((a) => (
                                        <span key={`${a.dateStr}-${a.tipo}`} className="inline-flex items-center rounded-lg border border-slate-200">
                                            <button
                                                type="button"
                                                onClick={() => onIr(a)}
                                                className="px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                                                data-aviso-dia={a.dateStr}
                                            >
                                                {a.dateStr.slice(8, 10)}/{a.dateStr.slice(5, 7)}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onVisto([idAviso(a)])}
                                                className="border-l border-slate-200 px-1 py-0.5 text-slate-300 hover:text-slate-600"
                                                title="Visto"
                                                aria-label="Marcar este día como visto"
                                            >
                                                <X size={9} />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            {avisos.length > 1 && (
                <div className="border-t border-slate-100 px-3 py-1.5 text-right">
                    <button
                        type="button"
                        onClick={() => onVisto(avisos.map(idAviso))}
                        className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
                        data-avisos-todos-vistos
                    >
                        Marcar todos como vistos
                    </button>
                </div>
            )}
            <p className="mt-2 break-words border-t border-slate-100 px-1 py-2 text-[11px] leading-snug text-slate-500" data-modo-rapido-avisos-ayuda>
                {TEXTO_PIN_AVISOS} Visto solo lo saca de esta lista.
            </p>
        </div>
    );
}

export function SelectorNovedad({
    tipos,
    onCerrar,
    onElegir,
}: {
    tipos: TipoNovedadRapida[];
    onCerrar: () => void;
    onElegir: (tipo: TipoNovedadRapida, motivo: string) => void;
}) {
    const [q, setQ] = useState('');
    const [motivo, setMotivo] = useState('');
    const [idx, setIdx] = useState(0);
    const lista = useMemo(() => {
        const f = q.trim().toLowerCase();
        return tipos.filter((t) => !f || `${t.code} ${t.label}`.toLowerCase().includes(f));
    }, [tipos, q]);
    useEffect(() => { setIdx(0); }, [q]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCerrar(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(lista.length - 1, i + 1)); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); return; }
            if (e.key === 'Enter' && lista[idx]) { e.preventDefault(); e.stopPropagation(); onElegir(lista[idx], motivo.trim()); }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [idx, lista, motivo, onCerrar, onElegir]);
    if (typeof document === 'undefined') return null;
    return createPortal(
        <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-slate-900/40 p-4" onClick={onCerrar} data-novedad-rapida>
            <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
                <div className="mb-2 flex items-center gap-2">
                    <p className="text-xs font-black uppercase text-slate-800">Novedad</p>
                    <button type="button" onClick={onCerrar} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-50" aria-label="Cerrar"><X size={14} /></button>
                </div>
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-1.5">
                    <Search size={13} className="text-slate-400" />
                    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código o nombre" className="w-full bg-transparent text-xs outline-none" data-novedad-buscar />
                </div>
                <ul className="mb-2 max-h-52 overflow-auto">
                    {lista.map((t, i) => (
                        <li key={`${t.code}-${t.label}`}>
                            <button
                                type="button"
                                onClick={() => onElegir(t, motivo.trim())}
                                className={`flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] ${i === idx ? 'bg-indigo-50 text-indigo-900' : 'hover:bg-slate-50'}`}
                                data-novedad-tipo={t.code}
                            >
                                <span className="w-10 font-black">{t.code}</span>
                                <span className="text-slate-600">{t.label}</span>
                            </button>
                        </li>
                    ))}
                    {lista.length === 0 && <li className="px-2 py-2 text-[11px] text-slate-400">Sin coincidencias.</li>}
                </ul>
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs" data-novedad-motivo />
            </div>
        </div>,
        document.body,
    );
}

export type DiaUi12 = { dateStr: string; aplicable: boolean; linea: string };

export function Cobertura12RangoBanner({
    titulo,
    dias,
    onAplicarTodo,
    onAplicarDia,
    onCerrar,
}: {
    titulo: string;
    dias: DiaUi12[];
    onAplicarTodo: () => void;
    onAplicarDia: (dateStr: string) => void;
    onCerrar: () => void;
}) {
    const [indice, setIndice] = useState<number | null>(null);
    if (typeof document === 'undefined') return null;
    const revisando = indice != null ? dias[indice] : null;
    const hay = dias.some((d) => d.aplicable);
    return createPortal(
        <div className="fixed left-1/2 top-20 z-[90] w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-red-200 bg-white px-4 py-3 shadow-lg no-print" data-cobertura-12h>
            <p className="whitespace-pre-line text-[12px] font-bold leading-snug text-slate-800" data-cobertura-12h-texto>{revisando ? revisando.linea : titulo}</p>
            {revisando ? (
                <p className="mt-1 text-[11px] text-slate-500">Día {indice! + 1} de {dias.length}</p>
            ) : (
                <p className="mt-1 text-[11px] text-slate-500">Es un cambio de turno a D12 y N12. {TEXTO_PIN_AVISOS}</p>
            )}
            <div className="mt-2 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={onCerrar} className="rounded-xl border border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50" data-cobertura-12h-no>No cubrir</button>
                {revisando ? (
                    <>
                        <button type="button" onClick={() => setIndice(null)} className="rounded-xl border border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">Volver</button>
                        <button type="button" onClick={() => setIndice((i) => (i == null ? 0 : (i + 1) % dias.length))} className="rounded-xl border border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">Siguiente</button>
                        {revisando.aplicable && (
                            <button type="button" onClick={() => onAplicarDia(revisando.dateStr)} className="rounded-xl bg-red-600 px-3 py-1 text-[11px] font-black text-white shadow-sm hover:bg-red-700" data-cobertura-12h-dia>Aplicar este día</button>
                        )}
                    </>
                ) : (
                    <>
                        <button type="button" onClick={() => setIndice(0)} className="rounded-xl border border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50" data-cobertura-12h-revisar>Día por día</button>
                        {hay && (
                            <button type="button" onClick={onAplicarTodo} className="rounded-xl bg-red-600 px-3 py-1 text-[11px] font-black text-white shadow-sm hover:bg-red-700" data-cobertura-12h-aplicar>Aplicar todo</button>
                        )}
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
}

export function Cierre12Banner({
    texto,
    alternativas,
    onElegir,
    francos,
    onFranco,
    aplicar = true,
    onConfirmar,
    onCancelar,
    ancla,
}: {
    texto: string;
    alternativas?: Array<{ empId: string; nombre: string; positionName: string; code: string; hours?: number; lado: string; bloqueado?: boolean; motivo?: string; elegido?: boolean }>;
    onElegir?: (empId: string, lado: string) => void;
    francos?: Array<{ empId: string; nombre: string }>;
    onFranco?: (empId: string) => void;
    aplicar?: boolean;
    onConfirmar: () => void;
    onCancelar: () => void;
    ancla?: { left: number; top: number; width: number; height: number } | null;
}) {
    const btnRef = useRef<HTMLButtonElement>(null);
    const cajaRef = useRef<HTMLDivElement>(null);
    const [medida, setMedida] = useState<Caja | null>(ancla ? { ...ancla } : null);
    const [alto, setAlto] = useState(240);
    useEffect(() => { btnRef.current?.focus(); }, [texto]);
    useEffect(() => {
        if (ancla) { setMedida({ left: ancla.left, top: ancla.top, width: ancla.width, height: ancla.height }); return; }
        const el = document.querySelector('[data-modo-rapido-cursor]');
        if (!el) return;
        const r = el.getBoundingClientRect();
        setMedida({ left: r.left, top: r.top, width: r.width, height: r.height });
    }, [ancla, texto]);
    useEffect(() => {
        const h = cajaRef.current?.offsetHeight;
        if (h && Math.abs(h - alto) > 12) setAlto(h);
    }, [alto, texto, alternativas?.length, francos?.length]);
    if (typeof document === 'undefined') return null;
    const ancho = Math.min(420, window.innerWidth - 16);
    const panelEl = document.querySelector('[data-paneles-planif]');
    const pr = panelEl?.getBoundingClientRect();
    const panel: Caja | null = pr && pr.width > 8 && pr.height > 8
        ? { left: pr.left, top: pr.top, width: pr.width, height: pr.height }
        : null;
    const anclaCaja: Caja = medida || { left: 16, top: Math.max(8, window.innerHeight - alto - 16), width: 0, height: 0 };
    const pos = ubicarCierre12({
        ancla: anclaCaja,
        panel,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        ancho,
        alto,
    });
    return createPortal(
        <div
            ref={cajaRef}
            className="fixed z-[90] rounded-2xl border border-indigo-200 bg-white px-4 py-3 shadow-lg no-print"
            style={{ left: pos.left, top: pos.top, width: ancho, maxWidth: 'calc(100vw - 16px)' }}
            data-cierre-12h
            data-cierre-12h-lado={pos.lado}
        >
            <p className="whitespace-pre-line text-[15px] font-black leading-snug text-slate-900" data-cierre-12h-texto>{texto}</p>
            {!!alternativas?.length && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-auto" data-cierre-12h-parejas>
                    {alternativas.map((a) => (
                        <li key={`${a.lado}-${a.empId}`}>
                            <button
                                type="button"
                                disabled={!!a.bloqueado}
                                onClick={() => onElegir?.(a.empId, a.lado)}
                                className={`flex w-full items-center justify-between rounded-xl px-2 py-1 text-left text-[12px] ${a.bloqueado ? 'cursor-not-allowed text-slate-400' : a.elegido ? 'bg-indigo-600 font-black text-white' : 'bg-slate-50 font-bold text-slate-800 hover:bg-indigo-50'}`}
                                data-pareja-12={a.empId}
                            >
                                <span>{a.nombre} {a.code} → {a.lado} · {a.positionName}{a.hours != null ? ` · ${a.hours} h` : ''}</span>
                                {a.bloqueado && <span>{a.motivo || 'no disponible'}</span>}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {!!francos?.length && (
                <ul className="mt-2 space-y-1" data-cierre-12h-ft>
                    {francos.map((f) => (
                        <li key={f.empId}>
                            <button type="button" onClick={() => onFranco?.(f.empId)} className="w-full rounded-xl bg-violet-50 px-2 py-1 text-left text-[12px] font-bold text-violet-900 hover:bg-violet-100" data-cierre-ft={f.empId}>
                                Pasar a FT a {f.nombre}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {aplicar && <p className="mt-1 text-[11px] text-slate-500">Para elegir otra pareja: mové el cursor con las flechas (o clic) al guardia que quieras ese día y apretá + otra vez. Con el cursor donde está, + aplica lo propuesto. Esc cancela.</p>}
            <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={onCancelar} className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50">Cancelar (Esc)</button>
                {aplicar && <button ref={btnRef} type="button" onClick={onConfirmar} className="rounded-xl bg-indigo-600 px-3 py-1.5 text-[12px] font-black text-white shadow-sm hover:bg-indigo-700" data-cierre-12h-confirmar>Aplicar (Enter)</button>}
            </div>
        </div>,
        document.body,
    );
}

/** Qué es la «E» de un día: evento (vinculado a `eventoId|servicioId` o sin vincular) o enfermedad. */
export type DecisionDiaE = { tipo: 'EVENTO' | 'E'; vinculo: string | null };
export type OpcionEventoPegado = { value: string; label: string };

export type PegarExcelEstado =
    | { paso: 'texto'; borrador: string; html?: string }
    | { paso: 'resumen'; preview: PreviewPegadoExcel; asignacion: Record<number, number | null>; decisiones: Record<number, DecisionDiaE> };

export function PegarExcelModal({
    estado,
    guardias,
    dias,
    eventosDe,
    onCerrar,
    onRevisar,
    onAsignar,
    onDecidir,
    onAplicar,
    puedeAlta,
    onDarDeAlta,
    plataforma,
    padron,
    fechaPadron,
    onAgregar,
    onAgregarTodos,
    onDefinir,
    tabla,
    onHorario,
    onActualizarServicio,
    objetivosAjenos,
    franjasAjeno,
    onAplicarAjenos,
}: {
    estado: PegarExcelEstado;
    guardias: GuardiaPegado[];
    /** dateStr por columna de la grilla. */
    dias: string[];
    eventosDe: (dateStr: string) => OpcionEventoPegado[];
    onCerrar: () => void;
    onRevisar: (texto: string, html?: string) => void;
    onAsignar: (indice: number, fila: number | null) => void;
    onDecidir: (col: number, decision: DecisionDiaE) => void;
    onAplicar: () => void;
    /** RRHH create o SuperAdmin. Sin permiso, la fila dice que hay que pedirle el alta a RRHH. */
    puedeAlta?: boolean;
    onDarDeAlta?: (fila: FilaPegadoExcel) => void;
    plataforma?: import('@/lib/planificacion/pegarPersonas').PersonaPlataforma[];
    padron?: import('@/lib/planificacion/padronAlta').FilaPadron[] | null;
    fechaPadron?: string;
    onAgregar?: (fila: FilaPegadoExcel, personaId: string) => void;
    onAgregarTodos?: (items: Array<{ fila: FilaPegadoExcel; personaId: string }>) => void;
    onDefinir?: (codigo: string, eq: import('@/lib/planificacion/definirCodigo').EquivalenciaGuardada) => void;
    tabla?: import('@/lib/planificacion/codigosHorarioPegado').FilaCodigoPlanilla[];
    onHorario?: (sigla: string, inicio: string, fin: string) => void;
    onActualizarServicio?: (cambios: import('@/lib/planificacion/codigosHorarioPegado').CambioHorarioServicio[]) => void;
    objetivosAjenos?: Array<{ id: string; clientId: string; clientName: string; name: string }>;
    franjasAjeno?: (objectiveId: string) => Promise<Array<{ positionName: string; code: string; startTime: string; endTime: string; hours: number }>>;
    onAplicarAjenos?: (items: Array<{ fila: number; col: number; objectiveId: string; clientId: string; objectiveName: string; positionName: string; code: string; startTime: string; endTime: string; hours: number; marca: string; banda: string }>) => void;
}) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            onCerrar();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onCerrar]);
    const [borrador, setBorrador] = useState(estado.paso === 'texto' ? estado.borrador : '');
    const [definiendo, setDefiniendo] = useState<string | null>(null);
    const [horarios, setHorarios] = useState(tabla || []);
    useEffect(() => { if (tabla) setHorarios(tabla); }, [tabla]);
    const grupos = estado.paso === 'resumen' ? clasificarPegado(estado.preview.filas, plataforma || [], padron || null) : null;
    const enPlataformaIdx = new Set(grupos?.enPlataforma.map((x) => x.fila.indice) ?? []);
    const ocupadas = new Set(estado.paso === 'resumen' ? Object.values(estado.asignacion).filter((v): v is number => v != null) : []);
    const [ajenoObj, setAjenoObj] = useState<Record<string, string>>({});
    const [ajenoFranja, setAjenoFranja] = useState<Record<string, string>>({});
    const [franjasPorMarca, setFranjasPorMarca] = useState<Record<string, Array<{ positionName: string; code: string; startTime: string; endTime: string; hours: number }>>>({});
    const marcasAjenas = estado.paso === 'resumen'
        ? [...new Map((estado.preview.codigosAjenos || []).map((c) => [c.marca, c])).values()]
        : [];
    const claveAjenos = marcasAjenas.map((c) => `${c.marca}:${c.objectiveId || ''}`).join('|');
    useEffect(() => {
        if (!franjasAjeno || !claveAjenos) return;
        let cancel = false;
        for (const c of marcasAjenas) {
            if (!c.objectiveId) continue;
            setAjenoObj((prev) => (prev[c.marca] ? prev : { ...prev, [c.marca]: c.objectiveId || '' }));
            void franjasAjeno(c.objectiveId).then((fr) => {
                if (cancel) return;
                setFranjasPorMarca((prev) => ({ ...prev, [c.marca]: fr }));
                const idx = fr.findIndex((f) => f.positionName === c.positionName && f.code === (c.banda || '') && f.startTime === c.startTime);
                if (idx >= 0) setAjenoFranja((prev) => (prev[c.marca] ? prev : { ...prev, [c.marca]: String(idx) }));
            });
        }
        return () => { cancel = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [claveAjenos]);
    const resumen = estado.paso === 'resumen' ? textoResumenPegado({
        filas: estado.preview.filas.length,
        encontrados: estado.preview.filas.filter((f) => estado.asignacion[f.indice] != null).length,
        sinEncontrar: sinEncontrarVisibles(estado.preview.filas, indicesAsignados(estado.asignacion), enPlataformaIdx),
        celdas: estado.preview.filas.reduce((a, f) => a + (estado.asignacion[f.indice] == null ? 0 : f.celdas.length), 0),
        desconocidos: estado.preview.desconocidos,
    }) : '';
    return (
        <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onCerrar} data-pegar-excel={estado.paso}>
            <div className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
                <div className="mb-2 flex items-center gap-2">
                    <ClipboardPaste size={16} className="text-indigo-600" />
                    <h3 className="text-sm font-black uppercase text-slate-800">Pegar desde Excel</h3>
                    <button type="button" onClick={onCerrar} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-50" aria-label="Cerrar"><X size={14} /></button>
                </div>
                {estado.paso === 'resumen' && marcasAjenas.length > 0 && (
                    <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-3" data-pegar-ajeno>
                        <p className="mb-2 text-[11px] font-bold text-slate-700">¿A qué objetivo y qué turno?</p>
                        {marcasAjenas.map((c) => {
                            const franjas = franjasPorMarca[c.marca] || [];
                            const objId = ajenoObj[c.marca] || c.objectiveId || '';
                            return (
                                <div key={c.marca} className="mb-2 grid grid-cols-1 gap-1" data-pegar-ajeno-fila={c.marca}>
                                    <span className="text-[11px] font-semibold text-slate-800">{c.codigo} →</span>
                                    <select
                                        className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-800"
                                        data-pegar-ajeno-obj={c.marca}
                                        value={objId}
                                        onChange={(e) => {
                                            const id = e.target.value;
                                            setAjenoObj((prev) => ({ ...prev, [c.marca]: id }));
                                            setAjenoFranja((prev) => ({ ...prev, [c.marca]: '' }));
                                            if (franjasAjeno && id) {
                                                void franjasAjeno(id).then((fr) => setFranjasPorMarca((prev) => ({ ...prev, [c.marca]: fr })));
                                            }
                                        }}
                                    >
                                        <option value="">objetivo: buscar…</option>
                                        {(objetivosAjenos || []).map((o) => (
                                            <option key={o.id} value={o.id}>{o.clientName} · {o.name}</option>
                                        ))}
                                    </select>
                                    <select
                                        className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-800"
                                        data-pegar-ajeno-franja={c.marca}
                                        value={ajenoFranja[c.marca] || ''}
                                        onChange={(e) => setAjenoFranja((prev) => ({ ...prev, [c.marca]: e.target.value }))}
                                    >
                                        <option value="">turno…</option>
                                        {franjas.map((f, i) => (
                                            <option key={`${f.positionName}-${f.code}-${i}`} value={String(i)}>{f.code} {f.startTime}–{f.endTime} · {f.positionName}</option>
                                        ))}
                                    </select>
                                </div>
                            );
                        })}
                        <button
                            type="button"
                            data-pegar-ajeno-asignar
                            className="mt-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:bg-white disabled:text-slate-400 disabled:border disabled:border-slate-200"
                            disabled={!onAplicarAjenos || marcasAjenas.every((c) => !(ajenoObj[c.marca] || c.objectiveId) || ajenoFranja[c.marca] === undefined || ajenoFranja[c.marca] === '')}
                            onClick={() => {
                                if (!onAplicarAjenos || estado.paso !== 'resumen') return;
                                const items = (estado.preview.codigosAjenos || []).flatMap((c) => {
                                    const id = ajenoObj[c.marca] || c.objectiveId || '';
                                    const obj = (objetivosAjenos || []).find((o) => o.id === id);
                                    const fr = (franjasPorMarca[c.marca] || [])[Number(ajenoFranja[c.marca])];
                                    if (!id || !obj || !fr) return [];
                                    return [{
                                        fila: c.fila,
                                        col: c.col,
                                        objectiveId: id,
                                        clientId: obj.clientId,
                                        objectiveName: obj.name,
                                        positionName: fr.positionName,
                                        code: fr.code,
                                        startTime: fr.startTime,
                                        endTime: fr.endTime,
                                        hours: fr.hours,
                                        marca: c.marca,
                                        banda: c.banda || fr.code,
                                    }];
                                });
                                onAplicarAjenos(items);
                            }}
                        >
                            Asignar en ese objetivo
                        </button>
                    </div>
                )}
                {estado.paso === 'texto' ? (
                    <>
                        <p className="mb-2 text-[11px] text-slate-500">Copiá en la planilla desde la columna del nombre hasta el último día y pegalo acá. Si el bloque trae los nombres, se acomoda por guardia antes de escribir.</p>
                        <textarea
                            value={borrador}
                            onChange={(e) => setBorrador(e.target.value)}
                            onPaste={(e) => {
                                const t = e.clipboardData.getData('text/plain');
                                if (t.trim()) {
                                    e.preventDefault();
                                    setBorrador(t);
                                    onRevisar(t, e.clipboardData.getData('text/html') || undefined);
                                }
                            }}
                            placeholder="Pegá acá con Ctrl+V"
                            className="mb-3 h-40 w-full rounded-xl border border-slate-200 p-2 font-mono text-[11px]"
                            data-pegar-texto
                            autoFocus
                        />
                        <div className="flex justify-end">
                            <button type="button" disabled={!borrador.trim()} onClick={() => onRevisar(borrador)} className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-black text-white shadow-sm hover:bg-indigo-700 disabled:border disabled:border-slate-200 disabled:bg-white disabled:text-slate-400" data-pegar-revisar>Revisar</button>
                        </div>
                    </>
                ) : (
                    <>
                        <p className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-[12px] font-medium text-indigo-950" data-pegar-resumen>{resumen}</p>
                        {estado.preview.diasE.length > 0 && (
                            <div className="mb-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2" data-pegar-dias-e={estado.preview.diasE.length}>
                                {estado.preview.diasE.map((d) => {
                                    const ds = dias[d.col] || '';
                                    const dec = estado.decisiones[d.col] || { tipo: d.porDefecto, vinculo: null };
                                    const opciones = eventosDe(ds);
                                    return (
                                        <div key={d.col} className="space-y-1" data-pegar-dia-e={ds}>
                                            <p className="text-[11px] font-black text-amber-950">{textoDiaE(d, ds)}</p>
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                {d.dudosas > 0 && (
                                                    <select
                                                        value={dec.tipo}
                                                        onChange={(e) => onDecidir(d.col, { tipo: e.target.value === 'E' ? 'E' : 'EVENTO', vinculo: dec.vinculo })}
                                                        className="rounded-lg border border-amber-200 bg-white px-1.5 py-1 text-[11px] font-bold"
                                                        data-pegar-e-tipo={ds}
                                                    >
                                                        <option value="EVENTO">Evento</option>
                                                        <option value="E">Enfermedad (E)</option>
                                                    </select>
                                                )}
                                                {dec.tipo === 'EVENTO' && (opciones.length > 0 ? (
                                                    <select
                                                        value={dec.vinculo || ''}
                                                        onChange={(e) => onDecidir(d.col, { tipo: 'EVENTO', vinculo: e.target.value || null })}
                                                        className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-1.5 py-1 text-[11px]"
                                                        data-pegar-e-evento={ds}
                                                    >
                                                        <option value="">Sin vincular · queda «Afectado a evento»</option>
                                                        {opciones.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                    </select>
                                                ) : (
                                                    <span className="text-[11px] text-amber-900" data-pegar-e-sin-evento={ds}>No hay eventos cargados ese día: queda «Afectado a evento», sin horas.</span>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                                <p className="text-[10px] leading-snug text-amber-800">Vincular asigna a cada guardia al servicio del evento (respeta el cupo). Sin vincular, la celda queda marcada «Afectado a evento» y no se escribe ningún turno.</p>
                            </div>
                        )}
                        {estado.paso === 'resumen' && grupos && (
                            <div className="mb-3 space-y-2 text-[12px]" data-pegar-grupos>
                                <p className="font-bold text-slate-700" data-pegar-grupos-texto>{textoGruposPegado(grupos)}{fechaPadron ? ` · Padrón del ${fechaPadron}` : ''}</p>
                                <div data-pegar-en-grilla>
                                    <p>En la grilla ({grupos.enGrilla.length})</p>
                                    {grupos.enGrilla.map((f) => {
                                        const guardia = guardias.find((g) => g.fila === (estado.asignacion[f.indice] ?? f.filaGrilla));
                                        return (
                                            <p key={f.indice} className="py-0.5 text-[11px] text-slate-600">
                                                <span className="font-black text-slate-800">{f.nombre}</span>
                                                {guardia ? ` · ${guardia.nombre}` : ''} · {f.celdas.length} celdas
                                            </p>
                                        );
                                    })}
                                </div>
                                <div data-pegar-en-plataforma>
                                    <div className="flex items-center gap-2">
                                        <span>En la plataforma, se agregan ({grupos.enPlataforma.length})</span>
                                        {grupos.enPlataforma.length > 0 && onAgregarTodos && (
                                            <button type="button" className="rounded-lg border border-indigo-200 px-2 py-0.5 text-[11px] font-bold text-indigo-700" data-pegar-agregar-todos onClick={() => onAgregarTodos(grupos.enPlataforma.map((x) => ({ fila: x.fila, personaId: x.persona.id })))}>Agregar todos</button>
                                        )}
                                    </div>
                                    {grupos.enPlataforma.map((x) => (
                                        <div key={x.fila.indice} className="flex items-center gap-2 py-0.5" data-pegar-plataforma={x.persona.legajo}>
                                            <span className="flex-1">{textoPlataforma(x.persona)}</span>
                                            <button type="button" className="rounded-lg bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white" data-pegar-agregar={x.persona.id} onClick={() => onAgregar?.(x.fila, x.persona.id)}>Agregar al cronograma</button>
                                        </div>
                                    ))}
                                </div>
                                <div data-pegar-para-alta>
                                    <p>Para dar de alta ({grupos.paraAlta.length})</p>
                                    <ul className="max-h-64 space-y-1 overflow-auto">
                                        {grupos.paraAlta.map((x) => (
                                            <FilaResumen key={x.fila.indice} fila={x.fila} guardias={guardias} ocupadas={ocupadas} asignada={estado.asignacion[x.fila.indice] ?? null} onAsignar={onAsignar} puedeAlta={puedeAlta} onDarDeAlta={onDarDeAlta} />
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        )}
                        {horarios.length > 0 && (
                            <div className="mb-3 rounded-xl border border-slate-200 px-3 py-2" data-pegar-codigos>
                                <p className="mb-1 text-[11px] font-black uppercase text-slate-500">Códigos de esta planilla</p>
                                {horarios.map((h) => (
                                    <label key={`${h.sigla}-${h.rojo ? 1 : 0}`} className="flex items-center gap-2 py-0.5 text-[12px]" data-pegar-codigo={h.sigla}>
                                        <span className="w-16 font-black">{h.sigla}{h.rojo ? ' roja' : ''}</span>
                                        <span className="text-slate-500">{h.code}</span>
                                        <input className="w-16 rounded border border-slate-200 px-1 py-0.5 font-mono text-[11px]" value={h.inicio} data-pegar-inicio={h.sigla} onChange={(e) => {
                                            const inicio = e.target.value;
                                            setHorarios((prev) => prev.map((x) => x.sigla === h.sigla && x.rojo === h.rojo ? { ...x, inicio, difiereServicio: inicio !== x.inicioServicio || x.fin !== x.finServicio } : x));
                                            onHorario?.(h.sigla, inicio, h.fin);
                                        }} />
                                        <span>–</span>
                                        <input className="w-16 rounded border border-slate-200 px-1 py-0.5 font-mono text-[11px]" value={h.fin} data-pegar-fin={h.sigla} onChange={(e) => {
                                            const fin = e.target.value;
                                            setHorarios((prev) => prev.map((x) => x.sigla === h.sigla && x.rojo === h.rojo ? { ...x, fin, difiereServicio: x.inicio !== x.inicioServicio || fin !== x.finServicio } : x));
                                            onHorario?.(h.sigla, h.inicio, fin);
                                        }} />
                                    </label>
                                ))}
                                {cambiosHorarioServicio(horarios).length > 0 && (
                                    <button type="button" className="mt-1 text-[11px] font-bold text-indigo-700" data-pegar-actualizar-servicio onClick={() => onActualizarServicio?.(cambiosHorarioServicio(horarios))}>
                                        Actualizar los horarios del servicio ({cambiosHorarioServicio(horarios).map((c) => `${c.code} ${c.antes} → ${c.despues}`).join(', ')})
                                    </button>
                                )}
                            </div>
                        )}
                        {estado.preview.desconocidos.length > 0 && (
                            <div className="mb-3 space-y-1 text-[11px] text-slate-600" data-pegar-desconocidos>
                                {estado.preview.desconocidos.map((cod) => {
                                    const prop = proponerDefinicion(cod);
                                    const n = estado.preview.filas.reduce((a, f) => a + (f.crudos || []).filter((c) => c.raw.replace(/\s/g, '') === cod.replace(/\s/g, '')).length, 0);
                                    return (
                                        <div key={cod} className="flex flex-wrap items-center gap-2" data-pegar-definir-fila={cod}>
                                            <span>{prop.vaciar ? textoCeldasVacias(cod, n, prop.partes.find((p) => p.tipo === 'otro_objetivo' && 'etiqueta' in p) ? (prop.partes.find((p) => p.tipo === 'otro_objetivo') as { etiqueta: string }).etiqueta : cod) : `${cod} no se reconoce (${n} celdas). ${prop.nota}`}</span>
                                            <button type="button" className="rounded-lg border border-slate-300 px-2 py-0.5 font-bold" data-pegar-definir={cod} onClick={() => { setDefiniendo(cod); onDefinir?.(cod, equivalenciaDeDefinicion(cod, prop)); }}>{definiendo === cod ? 'Definido' : 'Definir'}</button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={onCerrar} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50" data-pegar-cancelar>Cancelar</button>
                            <button
                                type="button"
                                onClick={onAplicar}
                                disabled={!estado.preview.filas.some((f) => estado.asignacion[f.indice] != null && f.celdas.length > 0)}
                                className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-black text-white shadow-sm hover:bg-indigo-700 disabled:border disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
                                data-pegar-aplicar
                            >
                                Aplicar
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function FilaResumen({
    fila,
    guardias,
    ocupadas,
    asignada,
    onAsignar,
    puedeAlta,
    onDarDeAlta,
}: {
    fila: FilaPegadoExcel;
    guardias: GuardiaPegado[];
    ocupadas: Set<number>;
    asignada: number | null;
    onAsignar: (indice: number, fila: number | null) => void;
    puedeAlta?: boolean;
    onDarDeAlta?: (fila: FilaPegadoExcel) => void;
}) {
    const guardia = guardias.find((g) => g.fila === asignada);
    if (asignada != null && guardia) {
        return (
            <li className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[11px] text-slate-600">
                <span className="w-36 shrink-0 truncate font-black text-slate-800" title={fila.nombre}>{fila.nombre}</span>
                <span className="truncate">{guardia.nombre}{fila.via === 'parecido' ? ' · parecido' : ''} · {fila.celdas.length} celdas</span>
            </li>
        );
    }
    const opciones = guardias.filter((g) => g.fila === asignada || !ocupadas.has(g.fila));
    return (
        <li className="flex items-center gap-2 rounded-lg bg-amber-50 px-1.5 py-1 text-[11px]">
            <span className="w-36 shrink-0 truncate font-black text-amber-900" title={fila.nombre}>{fila.nombre}</span>
            <select
                value={asignada ?? ''}
                onChange={(e) => onAsignar(fila.indice, e.target.value === '' ? null : Number(e.target.value))}
                className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-1.5 py-1 text-[11px]"
                data-pegar-asignar={fila.indice}
            >
                <option value="">Sin encontrar · elegí la fila</option>
                {opciones.map((g) => <option key={g.fila} value={g.fila}>{g.nombre}{g.legajo ? ` · ${g.legajo}` : ''}</option>)}
            </select>
            {puedeAlta ? (
                <button type="button" className="shrink-0 rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-black text-white shadow-sm hover:bg-indigo-700" data-pegar-alta={fila.indice} onClick={() => onDarDeAlta?.(fila)}>Dar de alta</button>
            ) : (
                <span className="shrink-0 text-[10px] font-bold text-slate-500" data-pegar-alta-rrhh={fila.indice}>Pedile a RRHH el alta de {fila.nombre.split(',')[0].split(' ')[0]}</span>
            )}
        </li>
    );
}
