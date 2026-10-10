import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    type CeldaRC,
    type Dimensiones,
    type OpcionCodigo,
    type RangoRC,
    moverCursor,
    codigoAlConfirmar,
    normalizarRango,
    sugerirCodigos,
    tamanoRango,
} from '@/lib/planificacion/modoRapido';

export type CapaModoRapidoApi = {
    click: (r: number, c: number, shift: boolean) => void;
    extender: (r: number, c: number) => void;
    irA: (r: number, c: number) => void;
    arrastrando: () => boolean;
};

/** `tenue`: aviso marcado como visto (la marca queda, más suave). */
export type MarcaAviso = { r: number; c: number; tipo: string; texto: string; tenue?: boolean };

type Props = {
    activo: boolean;
    contenedorRef: React.RefObject<HTMLDivElement>;
    dims: Dimensiones;
    /** Se vuelve a medir cuando cambia (filas, días, cambios pendientes). */
    version: string | number;
    opciones: (r: number, c: number) => OpcionCodigo[];
    valorDe: (r: number, c: number) => string;
    marcas: MarcaAviso[];
    onEscribir: (celdas: CeldaRC[], code: string) => void;
    onBorrar: (celdas: CeldaRC[]) => void;
    onCopiar: (rg: RangoRC, cortar: boolean) => string;
    /** `html`: lo que Excel pone junto al TSV (trae el color de cada celda). */
    onPegar: (inicio: CeldaRC | null, rg: RangoRC | null, texto: string, html?: string) => void;
    onRelleno: (rg: RangoRC, dir: 'abajo' | 'derecha') => void;
    onSerie: (origen: RangoRC, destino: CeldaRC) => void;
    onDeshacer: () => void;
    onRehacer: () => void;
    onGuardar: () => void;
    onCursor?: (cur: CeldaRC | null) => void;
    onMas?: (r: number, c: number, columna: boolean) => void;
    onMenos?: (r: number, c: number) => void;
    onMasDia?: (dateStr: string) => void;
    onNovedad?: (celdas: CeldaRC[]) => void;
    onConfirmar12?: () => void;
    onCancelar12?: () => void;
};

type Caja = { left: number; top: number; width: number; height: number };

const esEditable = (el: Element | null) => {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
};

const TECLA_CODIGO = /^[a-zA-Z0-9]$/;

export const ModoRapidoCapa = forwardRef<CapaModoRapidoApi, Props>(function ModoRapidoCapa(props, ref) {
    const { activo, contenedorRef, dims, version, marcas } = props;
    const [cursor, setCursor] = useState<CeldaRC | null>(null);
    const [ancla, setAncla] = useState<CeldaRC | null>(null);
    const [texto, setTexto] = useState<string | null>(null);
    const [elegida, setElegida] = useState(-1);
    const [serie, setSerie] = useState<CeldaRC | null>(null);
    const [sugLugar, setSugLugar] = useState<{ left: number; arriba: boolean; top: number; bottom: number } | null>(null);
    const [cajas, setCajas] = useState<{ cursor: Caja | null; rango: Caja | null; serie: Caja | null; marcas: Array<Caja & MarcaAviso> }>({ cursor: null, rango: null, serie: null, marcas: [] });
    const inputRef = useRef<HTMLInputElement>(null);
    const arrastre = useRef<'rango' | 'serie' | null>(null);
    const propsRef = useRef(props);
    propsRef.current = props;
    const estado = useRef({ cursor, ancla, texto, elegida, serie });
    estado.current = { cursor, ancla, texto, elegida, serie };

    const rango = useMemo<RangoRC | null>(() => (cursor ? normalizarRango(ancla || cursor, cursor) : null), [cursor, ancla]);
    const rangoRef = useRef(rango);
    rangoRef.current = rango;

    const sugerencias = useMemo(() => {
        if (texto == null || !cursor) return [];
        return sugerirCodigos(texto, propsRef.current.opciones(cursor.r, cursor.c), 8);
    }, [texto, cursor]);

    const td = useCallback((r: number, c: number) => contenedorRef.current?.querySelector<HTMLElement>(`td[data-rc="${r}:${c}"]`) || null, [contenedorRef]);

    const cajaDe = useCallback((a: CeldaRC, b: CeldaRC = a): Caja | null => {
        const cont = contenedorRef.current;
        const t1 = td(a.r, a.c);
        const t2 = td(b.r, b.c);
        if (!cont || !t1 || !t2) return null;
        const cr = cont.getBoundingClientRect();
        const r1 = t1.getBoundingClientRect();
        const r2 = t2.getBoundingClientRect();
        const left = Math.min(r1.left, r2.left) - cr.left + cont.scrollLeft;
        const top = Math.min(r1.top, r2.top) - cr.top + cont.scrollTop;
        const right = Math.max(r1.right, r2.right) - cr.left + cont.scrollLeft;
        const bottom = Math.max(r1.bottom, r2.bottom) - cr.top + cont.scrollTop;
        return { left, top, width: right - left, height: bottom - top };
    }, [contenedorRef, td]);

    const medir = useCallback(() => {
        const cur = estado.current.cursor;
        const rg = rangoRef.current;
        const sr = estado.current.serie;
        const nuevasMarcas: Array<Caja & MarcaAviso> = [];
        for (const m of propsRef.current.marcas.slice(0, 300)) {
            const cj = cajaDe({ r: m.r, c: m.c });
            if (cj) nuevasMarcas.push({ ...cj, ...m });
        }
        let serieCaja: Caja | null = null;
        if (rg && sr && (sr.r > rg.maxR || sr.c > rg.maxC)) {
            const derecha = sr.c - rg.maxC >= sr.r - rg.maxR;
            serieCaja = derecha
                ? cajaDe({ r: rg.minR, c: rg.minC }, { r: rg.maxR, c: Math.max(rg.maxC, sr.c) })
                : cajaDe({ r: rg.minR, c: rg.minC }, { r: Math.max(rg.maxR, sr.r), c: rg.maxC });
        }
        setCajas({
            cursor: cur ? cajaDe(cur) : null,
            rango: rg && tamanoRango(rg) > 1 ? cajaDe({ r: rg.minR, c: rg.minC }, { r: rg.maxR, c: rg.maxC }) : (cur ? cajaDe(cur) : null),
            serie: serieCaja,
            marcas: nuevasMarcas,
        });
    }, [cajaDe]);

    useLayoutEffect(() => { if (activo) medir(); }, [activo, cursor, ancla, serie, version, marcas, medir]);

    useLayoutEffect(() => {
        if (!activo || texto == null || !cursor || sugerencias.length === 0) { setSugLugar(null); return; }
        const medirSug = () => {
            const t = td(cursor.r, cursor.c);
            if (!t) { setSugLugar(null); return; }
            const r = t.getBoundingClientRect();
            const abajo = window.innerHeight - r.bottom;
            setSugLugar({ left: Math.max(8, r.left), arriba: abajo < 220 && r.top > abajo, top: r.bottom + 4, bottom: window.innerHeight - r.top + 4 });
        };
        medirSug();
        const cont = contenedorRef.current;
        cont?.addEventListener('scroll', medirSug, { passive: true });
        window.addEventListener('resize', medirSug);
        return () => {
            cont?.removeEventListener('scroll', medirSug);
            window.removeEventListener('resize', medirSug);
        };
    }, [activo, texto, cursor, sugerencias.length, td, contenedorRef]);

    useEffect(() => {
        if (!activo) return;
        const cont = contenedorRef.current;
        if (!cont || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => medir());
        const tabla = cont.querySelector('table');
        if (tabla) ro.observe(tabla);
        ro.observe(cont);
        return () => ro.disconnect();
    }, [activo, contenedorRef, medir, version]);

    /** Lleva la celda a la vista teniendo en cuenta la columna fija de dotación y el encabezado. */
    const seguir = useCallback((cur: CeldaRC) => {
        const cont = contenedorRef.current;
        const t = td(cur.r, cur.c);
        if (!cont || !t) return;
        const cr = cont.getBoundingClientRect();
        const r = t.getBoundingClientRect();
        const fija = cont.querySelector<HTMLElement>('th.planning-dotacion, td.planning-dotacion');
        const anchoFijo = fija ? fija.getBoundingClientRect().width : 0;
        const thead = cont.querySelector<HTMLElement>('thead');
        const altoEnc = thead ? thead.getBoundingClientRect().height : 0;
        const pie = cont.querySelector<HTMLElement>('tfoot');
        const altoPie = pie ? Math.min(pie.getBoundingClientRect().height, cr.height / 3) : 0;
        if (r.left < cr.left + anchoFijo) cont.scrollLeft -= cr.left + anchoFijo - r.left + 4;
        else if (r.right > cr.right) cont.scrollLeft += r.right - cr.right + 4;
        if (r.top < cr.top + altoEnc) cont.scrollTop -= cr.top + altoEnc - r.top + 4;
        else if (r.bottom > cr.bottom - altoPie) cont.scrollTop += r.bottom - (cr.bottom - altoPie) + 4;
    }, [contenedorRef, td]);

    const mover = useCallback((nuevo: CeldaRC, extenderRango: boolean) => {
        const { cursor: cur, ancla: an } = estado.current;
        if (extenderRango) setAncla(an || cur || nuevo);
        else setAncla(null);
        setCursor(nuevo);
        propsRef.current.onCursor?.(nuevo);
        requestAnimationFrame(() => seguir(nuevo));
    }, [seguir]);

    const enfocarContenedor = useCallback(() => {
        const cont = contenedorRef.current;
        if (cont && document.activeElement !== cont) cont.focus({ preventScroll: true });
    }, [contenedorRef]);

    useImperativeHandle(ref, () => ({
        click: (r, c, shift) => {
            setTexto(null);
            enfocarContenedor();
            if (shift && estado.current.cursor) {
                setAncla(estado.current.ancla || estado.current.cursor);
                setCursor({ r, c });
            } else {
                setAncla(null);
                setCursor({ r, c });
                arrastre.current = 'rango';
            }
            propsRef.current.onCursor?.({ r, c });
        },
        extender: (r, c) => {
            if (arrastre.current === 'rango') {
                setAncla((a) => a || estado.current.cursor);
                setCursor({ r, c });
            } else if (arrastre.current === 'serie') {
                setSerie({ r, c });
            }
        },
        irA: (r, c) => {
            enfocarContenedor();
            mover({ r, c }, false);
        },
        arrastrando: () => arrastre.current != null,
    }), [enfocarContenedor, mover]);

    useEffect(() => {
        if (!activo) return;
        const up = () => {
            if (arrastre.current === 'serie') {
                const rg = rangoRef.current;
                const sr = estado.current.serie;
                if (rg && sr) propsRef.current.onSerie(rg, sr);
                if (rg && sr) {
                    const derecha = sr.c - rg.maxC >= sr.r - rg.maxR;
                    const fin = derecha ? { r: rg.maxR, c: Math.max(rg.maxC, sr.c) } : { r: Math.max(rg.maxR, sr.r), c: rg.maxC };
                    setAncla({ r: rg.minR, c: rg.minC });
                    setCursor(fin);
                }
                setSerie(null);
            }
            arrastre.current = null;
        };
        window.addEventListener('mouseup', up);
        return () => window.removeEventListener('mouseup', up);
    }, [activo]);

    useEffect(() => {
        if (!activo) {
            setCursor(null);
            setAncla(null);
            setTexto(null);
            propsRef.current.onCursor?.(null);
        }
    }, [activo]);

    useEffect(() => {
        if (!cursor) return;
        if (cursor.r >= dims.filas || cursor.c >= dims.cols) {
            const r = Math.max(0, Math.min(cursor.r, dims.filas - 1));
            const c = Math.max(0, Math.min(cursor.c, dims.cols - 1));
            if (dims.filas === 0 || dims.cols === 0) { setCursor(null); setAncla(null); return; }
            setCursor({ r, c });
            setAncla(null);
        }
    }, [dims.filas, dims.cols, cursor]);

    const celdasActuales = useCallback((): CeldaRC[] => {
        const rg = rangoRef.current;
        if (!rg) return [];
        const out: CeldaRC[] = [];
        for (let r = rg.minR; r <= rg.maxR; r++) for (let c = rg.minC; c <= rg.maxC; c++) out.push({ r, c });
        return out;
    }, []);

    const confirmar = useCallback((tecla: string, shift: boolean) => {
        const { texto: t, elegida: idx, cursor: cur } = estado.current;
        if (t == null || !cur) return;
        const code = codigoAlConfirmar(t, propsRef.current.opciones(cur.r, cur.c), idx);
        setTexto(null);
        setElegida(-1);
        enfocarContenedor();
        if (code) propsRef.current.onEscribir(celdasActuales(), code);
        const rg = rangoRef.current;
        if (rg && tamanoRango(rg) > 1) return;
        const next = moverCursor(cur, tecla, { shift }, propsRef.current.dims);
        if (next) mover(next, false);
    }, [celdasActuales, enfocarContenedor, mover]);

    useEffect(() => {
        if (!activo) return;
        const onKey = (e: KeyboardEvent) => {
            if (document.querySelector('[data-modo-rapido-ayuda], [data-pegar-excel], [data-novedad-rapida]')) return;
            if (document.querySelector('[data-cierre-12h]')) {
                if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); propsRef.current.onConfirmar12?.(); }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); propsRef.current.onCancelar12?.(); }
                return;
            }
            const p = propsRef.current;
            const { cursor: cur, texto: t } = estado.current;
            const activeEl = document.activeElement;
            const enEditor = activeEl === inputRef.current;
            const cont = contenedorRef.current;
            if (!enEditor) {
                if (esEditable(activeEl)) return;
                const enGrilla = !activeEl || activeEl === document.body || (cont && cont.contains(activeEl));
                if (!enGrilla) return;
            }
            const mod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();
            const cortar = () => { e.preventDefault(); e.stopImmediatePropagation(); };

            if (mod && key === 's') { cortar(); if (t != null) confirmar('Enter', false); p.onGuardar(); return; }
            const cob = (activeEl as HTMLElement | null)?.closest?.('[data-cobertura-dia]') as HTMLElement | null;
            if (cob?.dataset.coberturaDia && (e.key === '+' || e.code === 'NumpadAdd' || (e.shiftKey && e.key === '='))) {
                cortar();
                p.onMasDia?.(cob.dataset.coberturaDia);
                return;
            }
            if (!cur) {
                if (p.dims.filas > 0 && p.dims.cols > 0 && (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'Enter' || e.key === 'Tab')) {
                    cortar();
                    mover({ r: 0, c: 0 }, false);
                }
                return;
            }

            if (enEditor || t != null) {
                if (e.key === 'Escape') { cortar(); setTexto(null); setElegida(-1); enfocarContenedor(); return; }
                const sug = sugerirCodigos(t || '', p.opciones(cur.r, cur.c), 8);
                if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && sug.length > 1) {
                    cortar();
                    setElegida((i) => {
                        const n = sug.length;
                        if (e.key === 'ArrowDown') return i < 0 ? 0 : (i + 1) % n;
                        return i <= 0 ? n - 1 : i - 1;
                    });
                    return;
                }
                if (e.key === 'Enter' || e.key === 'Tab' || e.key.startsWith('Arrow')) {
                    cortar();
                    confirmar(e.key, e.shiftKey);
                    return;
                }
                if (!enEditor && !mod && !e.altKey) {
                    // El input recibe el foco en el próximo frame: lo tipeado antes no se pierde.
                    if (TECLA_CODIGO.test(e.key)) { cortar(); setTexto((v) => `${v || ''}${e.key.toUpperCase()}`); setElegida(-1); return; }
                    if (e.key === 'Backspace') { cortar(); setTexto((v) => (v || '').slice(0, -1)); setElegida(-1); return; }
                }
                return;
            }

            if (mod && key === 'z' && !e.shiftKey) { cortar(); p.onDeshacer(); return; }
            if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { cortar(); p.onRehacer(); return; }
            if (mod && key === 'd') { cortar(); if (rangoRef.current) p.onRelleno(rangoRef.current, 'abajo'); return; }
            if (mod && key === 'r') { cortar(); if (rangoRef.current) p.onRelleno(rangoRef.current, 'derecha'); return; }
            if (mod && key === 'a') {
                cortar();
                setAncla({ r: 0, c: 0 });
                setCursor({ r: p.dims.filas - 1, c: p.dims.cols - 1 });
                return;
            }
            if (mod && (key === 'c' || key === 'x' || key === 'v')) {
                // copy / cut / paste los atienden los eventos del portapapeles; acá solo se frena al resto de la página.
                e.stopImmediatePropagation();
                return;
            }
            if (e.key === 'Escape') {
                cortar();
                if (estado.current.ancla) setAncla(null);
                else { setCursor(null); p.onCursor?.(null); }
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                cortar();
                p.onBorrar(celdasActuales());
                return;
            }
            if (e.key === 'F2') {
                cortar();
                setTexto(p.valorDe(cur.r, cur.c) || '');
                setElegida(-1);
                return;
            }
            const esMas = e.key === '+' || e.code === 'NumpadAdd' || (e.shiftKey && e.key === '=');
            const esMenos = (e.key === '-' || e.code === 'NumpadSubtract') && !e.shiftKey;
            if (!mod && !e.altKey && esMas) {
                cortar();
                p.onMas?.(cur.r, cur.c, e.shiftKey);
                return;
            }
            if (!mod && !e.altKey && esMenos) {
                cortar();
                p.onMenos?.(cur.r, cur.c);
                return;
            }
            if ((mod && key === 'l') || (!mod && e.key === '/')) {
                cortar();
                p.onNovedad?.(celdasActuales());
                return;
            }
            const next = moverCursor(cur, e.key, { ctrl: mod, shift: e.shiftKey }, p.dims, (r, c) => !!p.valorDe(r, c));
            if (next) {
                cortar();
                const extender = e.shiftKey && e.key !== 'Tab' && e.key !== 'Enter';
                mover(next, extender);
                return;
            }
            if (!mod && !e.altKey && TECLA_CODIGO.test(e.key)) {
                cortar();
                setTexto(e.key.toUpperCase());
                setElegida(-1);
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [activo, confirmar, contenedorRef, celdasActuales, enfocarContenedor, mover]);

    useEffect(() => {
        if (!activo) return;
        const enGrilla = () => {
            const a = document.activeElement;
            const cont = contenedorRef.current;
            if (a === inputRef.current) return false;
            if (esEditable(a)) return false;
            return !a || a === document.body || !!(cont && cont.contains(a));
        };
        const onCopy = (e: ClipboardEvent) => {
            if (document.querySelector('[data-modo-rapido-ayuda], [data-pegar-excel]')) return;
            const rg = rangoRef.current;
            if (!rg || !enGrilla()) return;
            const tsv = propsRef.current.onCopiar(rg, false);
            e.clipboardData?.setData('text/plain', tsv);
            e.preventDefault();
        };
        const onCut = (e: ClipboardEvent) => {
            if (document.querySelector('[data-modo-rapido-ayuda], [data-pegar-excel]')) return;
            const rg = rangoRef.current;
            if (!rg || !enGrilla()) return;
            const tsv = propsRef.current.onCopiar(rg, true);
            e.clipboardData?.setData('text/plain', tsv);
            e.preventDefault();
        };
        const onPaste = (e: ClipboardEvent) => {
            if (document.querySelector('[data-modo-rapido-ayuda], [data-pegar-excel]')) return;
            if (!enGrilla()) return;
            const rg = rangoRef.current;
            const cur = estado.current.cursor;
            const txt = e.clipboardData?.getData('text/plain') ?? '';
            const html = e.clipboardData?.getData('text/html') || undefined;
            e.preventDefault();
            const inicio = cur ? { r: rg?.minR ?? cur.r, c: rg?.minC ?? cur.c } : null;
            propsRef.current.onPegar(inicio, rg, txt, html);
        };
        document.addEventListener('copy', onCopy);
        document.addEventListener('cut', onCut);
        document.addEventListener('paste', onPaste);
        return () => {
            document.removeEventListener('copy', onCopy);
            document.removeEventListener('cut', onCut);
            document.removeEventListener('paste', onPaste);
        };
    }, [activo, contenedorRef]);

    useEffect(() => {
        if (texto != null) requestAnimationFrame(() => {
            const el = inputRef.current;
            if (!el) return;
            el.focus({ preventScroll: true });
            const n = el.value.length;
            el.setSelectionRange(n, n);
        });
    }, [texto != null]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!activo) return null;
    const cc = cajas.cursor;
    const rc = cajas.rango;
    return (
        <div className="pointer-events-none absolute left-0 top-0 z-[15]" data-modo-rapido-capa aria-hidden={texto == null}>
            {cajas.marcas.map((m, i) => (
                <span
                    key={`${m.r}:${m.c}:${m.tipo}:${i}`}
                    className={`absolute rounded-sm ${m.tipo === 'EVENTO' ? 'border-2 border-dashed border-yellow-500 bg-yellow-300/25' : 'border-2'} ${m.tipo === 'DESCANSO' ? 'border-amber-500' : m.tipo === 'TOPE' ? 'border-rose-500' : m.tipo === 'LICENCIA' ? 'border-fuchsia-500' : m.tipo === 'SERVICIO' ? 'border-slate-600' : m.tipo === 'CIERRE' ? 'border-indigo-600 bg-indigo-500/10' : m.tipo === 'EVENTO' ? '' : 'border-orange-500'} ${m.tenue ? 'opacity-40' : ''}`}
                    style={{ left: m.left + 1, top: m.top + 1, width: m.width - 2, height: m.height - 2 }}
                    title={m.texto}
                    data-modo-rapido-marca={m.tipo}
                    data-modo-rapido-marca-tenue={m.tenue ? '1' : undefined}
                />
            ))}
            {rc && rango && tamanoRango(rango) > 1 && (
                <div className="absolute border-2 border-indigo-500 bg-indigo-500/10" style={{ left: rc.left, top: rc.top, width: rc.width, height: rc.height }} data-modo-rapido-rango={`${tamanoRango(rango)}`} />
            )}
            {cajas.serie && (
                <div className="absolute border-2 border-dashed border-emerald-600" style={{ left: cajas.serie.left, top: cajas.serie.top, width: cajas.serie.width, height: cajas.serie.height }} />
            )}
            {cc && (
                <div className="absolute border-[3px] border-indigo-700 rounded-[3px] shadow-sm" style={{ left: cc.left - 1, top: cc.top - 1, width: cc.width + 2, height: cc.height + 2 }} data-modo-rapido-cursor={cursor ? `${cursor.r}:${cursor.c}` : ''} />
            )}
            {rc && texto == null && (
                <span
                    className="pointer-events-auto absolute h-2.5 w-2.5 cursor-crosshair rounded-[2px] border border-white bg-indigo-700 shadow-sm"
                    style={{ left: rc.left + rc.width - 6, top: rc.top + rc.height - 6 }}
                    title="Arrastrá para repetir el patrón"
                    data-modo-rapido-tirador
                    onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        arrastre.current = 'serie';
                        setSerie(null);
                    }}
                />
            )}
            {cc && texto != null && (
                <div className="pointer-events-auto absolute" style={{ left: cc.left - 1, top: cc.top - 1 }}>
                    <input
                        ref={inputRef}
                        value={texto}
                        onChange={(e) => { setTexto(e.target.value.toUpperCase()); setElegida(-1); }}
                        onBlur={() => { if (estado.current.texto != null) { setTexto(null); setElegida(-1); } }}
                        className="block rounded-[3px] border-[3px] border-indigo-700 bg-white px-1 text-center text-[11px] font-black uppercase text-slate-900 shadow-lg outline-none"
                        style={{ width: Math.max(cc.width + 2, 44), height: cc.height + 2 }}
                        data-modo-rapido-editor
                        spellCheck={false}
                        autoComplete="off"
                    />
                    {sugLugar && sugerencias.length > 0 && createPortal(
                        <ul
                            className="fixed z-[12000] min-w-[180px] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                            style={sugLugar.arriba ? { left: sugLugar.left, bottom: sugLugar.bottom } : { left: sugLugar.left, top: sugLugar.top }}
                            data-modo-rapido-sugerencias
                        >
                            {sugerencias.map((s, i) => (
                                <li
                                    key={`${s.code}-${i}`}
                                    onMouseDown={(e) => { e.preventDefault(); setElegida(i); requestAnimationFrame(() => confirmar('Enter', false)); }}
                                    className={`flex cursor-pointer items-center gap-2 px-2.5 py-1 text-[11px] ${i === elegida || (elegida < 0 && i === 0) ? 'bg-indigo-50 text-indigo-800' : 'text-slate-700 hover:bg-slate-50'}`}
                                >
                                    <span className="w-10 font-black">{s.code}</span>
                                    {s.horario && <span className="font-mono text-[10px] text-slate-500">{s.horario}</span>}
                                    {s.detalle && <span className="ml-auto truncate text-[9px] font-bold uppercase text-slate-400">{s.detalle}</span>}
                                </li>
                            ))}
                        </ul>,
                        document.body,
                    )}
                </div>
            )}
        </div>
    );
});
