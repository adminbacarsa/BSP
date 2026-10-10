import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ClipboardPaste, Keyboard, Search, X } from 'lucide-react';
import { agruparAvisos, ATAJOS_MODO_RAPIDO, textoResumenPegado, type AvisoRapido, type FilaPegadoExcel, type GuardiaPegado, type PreviewPegadoExcel, type TipoNovedadRapida } from '@/lib/planificacion/modoRapido';

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
                <p className="mb-2 text-[11px] text-slate-500">Hacé clic en una celda y escribí. Nada frena mientras cargás: los avisos quedan marcados y el PIN se pide al guardar.</p>
                <p className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-[11px] font-medium text-indigo-900" data-modo-rapido-ayuda-pegar>
                    Para pegar desde Excel: copiá desde la columna del nombre hasta el último día y apretá Ctrl+V en la grilla. El color de la celda no viaja: las M y N de 12 h se escriben D12 y N12, o con + si falta una banda.
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
};
const COLOR: Record<AvisoRapido['tipo'], string> = {
    DESCANSO: 'bg-amber-500',
    TOPE: 'bg-rose-500',
    LICENCIA: 'bg-fuchsia-500',
    SOLAPE: 'bg-orange-500',
};

const AVISOS_ABIERTOS_KEY = 'cosp-planif-avisos-abierto';

export function ModoRapidoAvisosPanel({
    avisos,
    sinServicio,
    onIr,
}: {
    avisos: AvisoRapido[];
    sinServicio: boolean;
    onIr: (a: AvisoRapido) => void;
}) {
    const grupos = useMemo(() => agruparAvisos(avisos), [avisos]);
    const [abierto, setAbierto] = useState(false);
    const [desplegado, setDesplegado] = useState<string | null>(null);
    const listo = useRef(false);
    useEffect(() => {
        if (listo.current) return;
        listo.current = true;
        const guardado = typeof window !== 'undefined' ? window.localStorage.getItem(AVISOS_ABIERTOS_KEY) : null;
        if (guardado === '1') setAbierto(true);
        else if (guardado === '0') setAbierto(false);
        else setAbierto(avisos.length <= 3);
    }, [avisos.length]);
    const toggle = () => {
        setAbierto((v) => {
            const next = !v;
            if (typeof window !== 'undefined') window.localStorage.setItem(AVISOS_ABIERTOS_KEY, next ? '1' : '0');
            return next;
        });
    };
    if (!avisos.length && !sinServicio) return null;
    if (typeof document === 'undefined') return null;
    if (!abierto) {
        return createPortal(
            <button
                type="button"
                onClick={toggle}
                className="fixed bottom-16 right-4 z-[80] flex items-center gap-1.5 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-[11px] font-black text-amber-800 shadow-lg hover:bg-amber-50 no-print"
                data-modo-rapido-avisos={avisos.length}
                data-modo-rapido-avisos-pill
            >
                <AlertTriangle size={13} className="text-amber-500" />
                {avisos.length} aviso{avisos.length === 1 ? '' : 's'}
            </button>,
            document.body,
        );
    }
    return createPortal(
        <div className="fixed bottom-16 right-4 z-[80] w-[320px] rounded-2xl border border-slate-200 bg-white shadow-lg no-print" data-modo-rapido-avisos={avisos.length}>
            <button type="button" onClick={toggle} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                <AlertTriangle size={14} className={avisos.length ? 'text-amber-500' : 'text-slate-400'} />
                <span className="text-[11px] font-black uppercase text-slate-700">{avisos.length} aviso{avisos.length === 1 ? '' : 's'}</span>
                <span className="ml-auto text-[10px] font-bold text-slate-400">Ocultar</span>
            </button>
            <div className="max-h-[260px] overflow-auto border-t border-slate-100 px-2 py-1.5">
                {sinServicio && (
                    <p className="px-1 pb-1.5 text-[10px] font-bold text-slate-500">Sin servicio: no se valida cobertura.</p>
                )}
                {grupos.length === 0 && <p className="px-1 py-1 text-[11px] text-slate-400">Sin avisos.</p>}
                {grupos.map((g) => {
                    const abiertoGrupo = desplegado === g.clave;
                    return (
                        <div key={g.clave}>
                            <button
                                type="button"
                                onClick={() => {
                                    if (g.items.length === 1) onIr(g.items[0]);
                                    else setDesplegado(abiertoGrupo ? null : g.clave);
                                }}
                                className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-slate-50"
                                data-aviso-grupo={g.empId}
                            >
                                <span className={`mt-0.5 shrink-0 rounded px-1 text-[8px] font-black uppercase text-white ${COLOR[g.tipo]}`}>{ETIQUETA[g.tipo]}</span>
                                <span className="text-[11px] leading-snug text-slate-700">{g.texto}</span>
                            </button>
                            {abiertoGrupo && g.items.length > 1 && (
                                <div className="mb-1 ml-8 flex flex-wrap gap-1">
                                    {g.items.map((a) => (
                                        <button
                                            key={`${a.dateStr}-${a.tipo}`}
                                            type="button"
                                            onClick={() => onIr(a)}
                                            className="rounded-lg border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                                            data-aviso-dia={a.dateStr}
                                        >
                                            {a.dateStr.slice(8, 10)}/{a.dateStr.slice(5, 7)}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <p className="border-t border-slate-100 px-3 py-2 text-[10px] leading-snug text-slate-400" data-modo-rapido-avisos-ayuda>
                Descanso de 8 a 12 h y tope piden un PIN al guardar; menos de 8 h no se guarda
            </p>
        </div>,
        document.body,
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

export function Cierre12Banner({ texto, onConfirmar, onCancelar }: { texto: string; onConfirmar: () => void; onCancelar: () => void }) {
    if (typeof document === 'undefined') return null;
    return createPortal(
        <div className="fixed left-1/2 top-20 z-[90] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-indigo-200 bg-white px-4 py-3 shadow-lg no-print" data-cierre-12h>
            <p className="whitespace-pre-line text-[12px] font-bold leading-snug text-slate-800" data-cierre-12h-texto>{texto}</p>
            <p className="mt-1 text-[11px] text-slate-500">Enter confirma, Esc cancela</p>
            <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={onCancelar} className="rounded-xl border border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button type="button" onClick={onConfirmar} className="rounded-xl bg-indigo-600 px-3 py-1 text-[11px] font-black text-white shadow-sm hover:bg-indigo-700" data-cierre-12h-confirmar>Confirmar</button>
            </div>
        </div>,
        document.body,
    );
}

export type PegarExcelEstado =
    | { paso: 'texto'; borrador: string }
    | { paso: 'resumen'; preview: PreviewPegadoExcel; asignacion: Record<number, number | null> };

export function PegarExcelModal({
    estado,
    guardias,
    onCerrar,
    onRevisar,
    onAsignar,
    onAplicar,
}: {
    estado: PegarExcelEstado;
    guardias: GuardiaPegado[];
    onCerrar: () => void;
    onRevisar: (texto: string) => void;
    onAsignar: (indice: number, fila: number | null) => void;
    onAplicar: () => void;
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
    const resumen = estado.paso === 'resumen' ? textoResumenPegado({
        filas: estado.preview.filas.length,
        encontrados: estado.preview.filas.filter((f) => estado.asignacion[f.indice] != null).length,
        sinEncontrar: estado.preview.filas.filter((f) => estado.asignacion[f.indice] == null).map((f) => f.nombre),
        celdas: estado.preview.filas.reduce((a, f) => a + (estado.asignacion[f.indice] == null ? 0 : f.celdas.length), 0),
        desconocidos: estado.preview.desconocidos,
    }) : '';
    const ocupadas = new Set(estado.paso === 'resumen' ? Object.values(estado.asignacion).filter((v): v is number => v != null) : []);
    return (
        <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onCerrar} data-pegar-excel={estado.paso}>
            <div className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
                <div className="mb-2 flex items-center gap-2">
                    <ClipboardPaste size={16} className="text-indigo-600" />
                    <h3 className="text-sm font-black uppercase text-slate-800">Pegar desde Excel</h3>
                    <button type="button" onClick={onCerrar} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-50" aria-label="Cerrar"><X size={14} /></button>
                </div>
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
                                    onRevisar(t);
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
                        <ul className="mb-3 max-h-64 space-y-1 overflow-auto">
                            {estado.preview.filas.map((f) => (
                                <FilaResumen key={f.indice} fila={f} guardias={guardias} ocupadas={ocupadas} asignada={estado.asignacion[f.indice] ?? null} onAsignar={onAsignar} />
                            ))}
                        </ul>
                        {estado.preview.desconocidos.length > 0 && (
                            <p className="mb-3 text-[11px] text-slate-500">No se escriben: {estado.preview.desconocidos.join(', ')}. El color no se copia: las de 12 h van como D12 y N12.</p>
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
}: {
    fila: FilaPegadoExcel;
    guardias: GuardiaPegado[];
    ocupadas: Set<number>;
    asignada: number | null;
    onAsignar: (indice: number, fila: number | null) => void;
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
        </li>
    );
}
