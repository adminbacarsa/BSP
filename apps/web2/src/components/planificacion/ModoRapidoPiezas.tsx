import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CalendarRange, ClipboardPaste, Copy, Keyboard, X } from 'lucide-react';
import { ATAJOS_MODO_RAPIDO, textoResumenPegado, type AvisoRapido, type FilaPegadoExcel, type GuardiaPegado, type PreviewPegadoExcel } from '@/lib/planificacion/modoRapido';

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
                    Para pegar desde Excel: copiá desde la columna del nombre hasta el último día y apretá Ctrl+V en la grilla. El color de la celda no viaja: las M y N de 12 h hay que escribirlas como D12 y N12.
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

export function ModoRapidoAvisosPanel({
    avisos,
    sinServicio,
    onIr,
}: {
    avisos: AvisoRapido[];
    sinServicio: boolean;
    onIr: (a: AvisoRapido) => void;
}) {
    const [abierto, setAbierto] = useState(true);
    if (!avisos.length && !sinServicio) return null;
    if (typeof document === 'undefined') return null;
    return createPortal(
        <div className="fixed bottom-4 right-4 z-[80] w-[300px] rounded-2xl border border-slate-200 bg-white shadow-lg no-print" data-modo-rapido-avisos={avisos.length}>
            <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                <AlertTriangle size={14} className={avisos.length ? 'text-amber-500' : 'text-slate-400'} />
                <span className="text-[11px] font-black uppercase text-slate-700">Avisos ({avisos.length})</span>
                <span className="ml-auto text-[10px] font-bold text-slate-400">{abierto ? 'Ocultar' : 'Ver'}</span>
            </button>
            {abierto && (
                <div className="max-h-[260px] overflow-auto border-t border-slate-100 px-2 py-1.5">
                    {sinServicio && (
                        <p className="px-1 pb-1.5 text-[10px] font-bold text-slate-500">Sin servicio: no se valida cobertura.</p>
                    )}
                    {avisos.length === 0 && <p className="px-1 py-1 text-[11px] text-slate-400">Sin avisos.</p>}
                    {avisos.map((a, i) => (
                        <button
                            key={`${a.tipo}-${a.empId}-${a.dateStr}-${i}`}
                            type="button"
                            onClick={() => onIr(a)}
                            className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-slate-50"
                        >
                            <span className={`mt-0.5 shrink-0 rounded px-1 text-[8px] font-black uppercase text-white ${COLOR[a.tipo]}`}>{ETIQUETA[a.tipo]}</span>
                            <span className="text-[11px] leading-snug text-slate-700">{a.texto}</span>
                        </button>
                    ))}
                    {avisos.length > 0 && (
                        <p className="px-1 pt-1.5 text-[10px] text-slate-400">Descanso de 8 a 12 h y tope piden PIN al guardar, una sola vez. Menos de 8 h no se guarda.</p>
                    )}
                </div>
            )}
        </div>,
        document.body,
    );
}

export type CopiarDeEleccion = { objectiveId: string; objectiveName: string; year: number; month: number; soloVacias: boolean };

export function CopiarDeModal({
    clientes,
    objetivoActual,
    year,
    month,
    cargando,
    onCancelar,
    onConfirmar,
}: {
    clientes: Array<{ id: string; name?: string; objetivos?: Array<{ id?: string; name?: string }> }>;
    objetivoActual: string;
    year: number;
    month: number;
    cargando: boolean;
    onCancelar: () => void;
    onConfirmar: (e: CopiarDeEleccion) => void;
}) {
    const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
    const [objId, setObjId] = useState(objetivoActual);
    const [mes, setMes] = useState(`${prev.y}-${String(prev.m).padStart(2, '0')}`);
    const [soloVacias, setSoloVacias] = useState(true);
    const [filtro, setFiltro] = useState('');
    const opciones = useMemo(() => {
        const out: Array<{ id: string; label: string }> = [];
        for (const c of clientes) {
            for (const o of c.objetivos || []) {
                const id = String(o.id || o.name || '');
                if (!id) continue;
                out.push({ id, label: `${c.name || ''} · ${o.name || id}` });
            }
        }
        const f = filtro.trim().toLowerCase();
        return (f ? out.filter((o) => o.label.toLowerCase().includes(f)) : out).sort((a, b) => a.label.localeCompare(b.label));
    }, [clientes, filtro]);
    const elegido = opciones.find((o) => o.id === objId);
    const [y, m] = mes.split('-').map(Number);
    const mismo = objId === objetivoActual && y === year && m === month;
    return (
        <div className="fixed inset-0 z-[9200] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onCancelar}>
            <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()} data-copiar-de>
                <div className="mb-3 flex items-center gap-2">
                    <Copy size={16} className="text-indigo-600" />
                    <h3 className="text-sm font-black uppercase text-slate-800">Copiar de…</h3>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">Trae el cronograma de otro objetivo o mes como borrador. Los guardias que ya están en la dotación se alinean por persona; los demás se agregan como filas.</p>
                <label className="mb-1 block text-[10px] font-black uppercase text-slate-500">Objetivo</label>
                <input
                    value={filtro}
                    onChange={(e) => setFiltro(e.target.value)}
                    placeholder="Buscar cliente u objetivo…"
                    className="mb-1.5 w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs"
                />
                <select value={objId} onChange={(e) => setObjId(e.target.value)} size={6} className="mb-3 w-full rounded-xl border border-slate-200 p-1 text-xs" data-copiar-de-objetivo>
                    {opciones.map((o) => <option key={o.id} value={o.id}>{o.label}{o.id === objetivoActual ? ' (este)' : ''}</option>)}
                </select>
                <label className="mb-1 block text-[10px] font-black uppercase text-slate-500"><CalendarRange size={11} className="mr-1 inline" />Mes</label>
                <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="mb-3 w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs" data-copiar-de-mes />
                <label className="mb-4 flex items-center gap-2 text-[11px] text-slate-600">
                    <input type="checkbox" checked={soloVacias} onChange={(e) => setSoloVacias(e.target.checked)} />
                    Solo celdas vacías (no pisa lo que ya está cargado)
                </label>
                {mismo && <p className="mb-2 text-[11px] font-bold text-rose-600">Elegí otro objetivo u otro mes.</p>}
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onCancelar} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
                    <button
                        type="button"
                        disabled={!objId || !y || !m || mismo || cargando}
                        onClick={() => onConfirmar({ objectiveId: objId, objectiveName: elegido?.label || objId, year: y, month: m, soloVacias })}
                        className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-black text-white shadow-sm hover:bg-indigo-700 disabled:border disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
                        data-copiar-de-confirmar
                    >
                        {cargando ? 'Trayendo…' : 'Traer como borrador'}
                    </button>
                </div>
            </div>
        </div>
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
