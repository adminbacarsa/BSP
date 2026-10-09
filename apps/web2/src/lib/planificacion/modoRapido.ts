/**
 * Modo rápido de la grilla de Planificación: se maneja como una planilla.
 * Lógica pura (cursor, rangos, pegado TSV, relleno de patrón, historial, avisos).
 */

export type CeldaRC = { r: number; c: number };
export type RangoRC = { minR: number; maxR: number; minC: number; maxC: number };
export type Dimensiones = { filas: number; cols: number };
export type ModsTecla = { ctrl?: boolean; shift?: boolean };

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function normalizarRango(a: CeldaRC, b: CeldaRC = a): RangoRC {
    return {
        minR: Math.min(a.r, b.r),
        maxR: Math.max(a.r, b.r),
        minC: Math.min(a.c, b.c),
        maxC: Math.max(a.c, b.c),
    };
}

export function celdasDeRango(rg: RangoRC): CeldaRC[] {
    const out: CeldaRC[] = [];
    for (let r = rg.minR; r <= rg.maxR; r++) for (let c = rg.minC; c <= rg.maxC; c++) out.push({ r, c });
    return out;
}

export const tamanoRango = (rg: RangoRC) => (rg.maxR - rg.minR + 1) * (rg.maxC - rg.minC + 1);

/**
 * Ctrl+flecha como en Excel: si la celda y la siguiente tienen dato, va hasta el último con dato;
 * si no, salta al próximo con dato; sin dato en el camino, al borde.
 */
function saltoCtrl(cur: CeldaRC, dr: number, dc: number, dims: Dimensiones, ocupada?: (r: number, c: number) => boolean): CeldaRC {
    const dentro = (r: number, c: number) => r >= 0 && c >= 0 && r < dims.filas && c < dims.cols;
    const borde = { r: dr ? (dr > 0 ? dims.filas - 1 : 0) : cur.r, c: dc ? (dc > 0 ? dims.cols - 1 : 0) : cur.c };
    if (!ocupada) return borde;
    let r = cur.r + dr;
    let c = cur.c + dc;
    if (!dentro(r, c)) return cur;
    if (ocupada(cur.r, cur.c) && ocupada(r, c)) {
        while (dentro(r + dr, c + dc) && ocupada(r + dr, c + dc)) { r += dr; c += dc; }
        return { r, c };
    }
    while (dentro(r, c) && !ocupada(r, c)) {
        if (!dentro(r + dr, c + dc)) return { r, c };
        r += dr; c += dc;
    }
    return { r, c };
}

/** Mueve el cursor según la tecla. Devuelve null si la tecla no mueve. */
export function moverCursor(
    cur: CeldaRC,
    tecla: string,
    mods: ModsTecla,
    dims: Dimensiones,
    ocupada?: (r: number, c: number) => boolean,
): CeldaRC | null {
    if (dims.filas <= 0 || dims.cols <= 0) return null;
    const lastR = dims.filas - 1;
    const lastC = dims.cols - 1;
    const base = { r: clamp(cur.r, 0, lastR), c: clamp(cur.c, 0, lastC) };
    const dir: Record<string, [number, number]> = {
        ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    };
    if (dir[tecla]) {
        const [dr, dc] = dir[tecla];
        if (mods.ctrl) return saltoCtrl(base, dr, dc, dims, ocupada);
        return { r: clamp(base.r + dr, 0, lastR), c: clamp(base.c + dc, 0, lastC) };
    }
    if (tecla === 'Tab') {
        if (mods.shift) {
            if (base.c > 0) return { r: base.r, c: base.c - 1 };
            return base.r > 0 ? { r: base.r - 1, c: lastC } : base;
        }
        if (base.c < lastC) return { r: base.r, c: base.c + 1 };
        return base.r < lastR ? { r: base.r + 1, c: 0 } : base;
    }
    if (tecla === 'Enter') {
        return { r: clamp(base.r + (mods.shift ? -1 : 1), 0, lastR), c: base.c };
    }
    if (tecla === 'Home') return mods.ctrl ? { r: 0, c: 0 } : { r: base.r, c: 0 };
    if (tecla === 'End') return mods.ctrl ? { r: lastR, c: lastC } : { r: base.r, c: lastC };
    if (tecla === 'PageDown') return { r: clamp(base.r + 10, 0, lastR), c: base.c };
    if (tecla === 'PageUp') return { r: clamp(base.r - 10, 0, lastR), c: base.c };
    return null;
}

/** Texto pegado de Excel / Sheets → matriz de códigos en mayúscula. */
export function parsearTsv(texto: string): string[][] {
    if (!texto) return [];
    const filas = texto.replace(/\r\n?/g, '\n').split('\n');
    while (filas.length && filas[filas.length - 1].trim() === '') filas.pop();
    return filas.map((f) => f.split('\t').map((v) => v.trim().replace(/^"|"$/g, '').toUpperCase()));
}

export function matrizATsv(m: string[][]): string {
    return m.map((f) => f.join('\t')).join('\n');
}

/** Menor período p tal que la secuencia se repite cada p (M M M M F F M M → 6). */
export function detectarCiclo(seq: string[]): number {
    const n = seq.length;
    for (let p = 1; p < n; p++) {
        let ok = true;
        for (let i = p; i < n; i++) if (seq[i] !== seq[i - p]) { ok = false; break; }
        if (ok) return p;
    }
    return Math.max(1, n);
}

/**
 * Índices de origen para continuar la secuencia `largo` posiciones más.
 * Si el origen tiene un ciclo completo y algo más, sigue la fase (M M M M M M F F M → M M M …).
 */
export function continuarPatronIndices(seq: string[], largo: number): number[] {
    const n = seq.length;
    if (n === 0 || largo <= 0) return [];
    const p = detectarCiclo(seq);
    const out: number[] = [];
    for (let i = 0; i < largo; i++) out.push((n + i) % p);
    return out;
}

export function continuarPatron(seq: string[], largo: number): string[] {
    return continuarPatronIndices(seq, largo).map((i) => seq[i]);
}

export type DireccionSerie = 'abajo' | 'derecha';

/**
 * Tirador de relleno: dado el rango origen y la celda donde se soltó, qué celda destino
 * toma el valor de qué celda origen.
 */
export function planSerie(origen: RangoRC, destino: CeldaRC, valor: (r: number, c: number) => string):
    { direccion: DireccionSerie; pares: Array<{ desde: CeldaRC; hacia: CeldaRC }> } | null {
    const dAbajo = destino.r - origen.maxR;
    const dDerecha = destino.c - origen.maxC;
    if (dAbajo <= 0 && dDerecha <= 0) return null;
    const pares: Array<{ desde: CeldaRC; hacia: CeldaRC }> = [];
    if (dDerecha >= dAbajo) {
        for (let r = origen.minR; r <= origen.maxR; r++) {
            const seq: string[] = [];
            for (let c = origen.minC; c <= origen.maxC; c++) seq.push(valor(r, c));
            continuarPatronIndices(seq, dDerecha).forEach((idx, i) => {
                pares.push({ desde: { r, c: origen.minC + idx }, hacia: { r, c: origen.maxC + 1 + i } });
            });
        }
        return { direccion: 'derecha', pares };
    }
    for (let c = origen.minC; c <= origen.maxC; c++) {
        const seq: string[] = [];
        for (let r = origen.minR; r <= origen.maxR; r++) seq.push(valor(r, c));
        continuarPatronIndices(seq, dAbajo).forEach((idx, i) => {
            pares.push({ desde: { r: origen.minR + idx, c }, hacia: { r: origen.maxR + 1 + i, c } });
        });
    }
    return { direccion: 'abajo', pares };
}

/** Ctrl+D / Ctrl+R. Con una sola celda copia la de arriba / la de la izquierda. */
export function planRelleno(rg: RangoRC, direccion: DireccionSerie): Array<{ desde: CeldaRC; hacia: CeldaRC }> {
    const pares: Array<{ desde: CeldaRC; hacia: CeldaRC }> = [];
    if (direccion === 'abajo') {
        if (rg.minR === rg.maxR) {
            if (rg.minR === 0) return [];
            for (let c = rg.minC; c <= rg.maxC; c++) pares.push({ desde: { r: rg.minR - 1, c }, hacia: { r: rg.minR, c } });
            return pares;
        }
        for (let c = rg.minC; c <= rg.maxC; c++) {
            for (let r = rg.minR + 1; r <= rg.maxR; r++) pares.push({ desde: { r: rg.minR, c }, hacia: { r, c } });
        }
        return pares;
    }
    if (rg.minC === rg.maxC) {
        if (rg.minC === 0) return [];
        for (let r = rg.minR; r <= rg.maxR; r++) pares.push({ desde: { r, c: rg.minC - 1 }, hacia: { r, c: rg.minC } });
        return pares;
    }
    for (let r = rg.minR; r <= rg.maxR; r++) {
        for (let c = rg.minC + 1; c <= rg.maxC; c++) pares.push({ desde: { r, c: rg.minC }, hacia: { r, c } });
    }
    return pares;
}

/** Pegado de una matriz desde la celda activa. Si el destino es un rango más grande y la matriz es 1×1, la repite. */
export function planPegado(m: string[][], inicio: CeldaRC, dims: Dimensiones, rangoDestino?: RangoRC):
    Array<{ r: number; c: number; valor: string; fila: number; col: number }> {
    const out: Array<{ r: number; c: number; valor: string; fila: number; col: number }> = [];
    if (!m.length) return out;
    const alto = m.length;
    const ancho = Math.max(...m.map((f) => f.length));
    const repetir = rangoDestino && tamanoRango(rangoDestino) > alto * ancho
        && (rangoDestino.maxR - rangoDestino.minR + 1) % alto === 0
        && (rangoDestino.maxC - rangoDestino.minC + 1) % ancho === 0;
    const filas = repetir ? rangoDestino!.maxR - rangoDestino!.minR + 1 : alto;
    const cols = repetir ? rangoDestino!.maxC - rangoDestino!.minC + 1 : ancho;
    for (let i = 0; i < filas; i++) {
        for (let j = 0; j < cols; j++) {
            const r = inicio.r + i;
            const c = inicio.c + j;
            if (r >= dims.filas || c >= dims.cols) continue;
            const fila = i % alto;
            const col = j % ancho;
            out.push({ r, c, valor: m[fila][col] ?? '', fila, col });
        }
    }
    return out;
}

/* ── Historial (deshacer / rehacer) ─────────────────────────────────────── */

export type Historial<T> = { atras: T[]; adelante: T[]; max: number };

export const crearHistorial = <T>(max = 60): Historial<T> => ({ atras: [], adelante: [], max });

/** Antes de un cambio: guarda el estado previo y descarta lo rehacible. */
export function registrarCambio<T>(h: Historial<T>, previo: T): Historial<T> {
    const atras = [...h.atras, previo];
    if (atras.length > h.max) atras.shift();
    return { ...h, atras, adelante: [] };
}

export function deshacer<T>(h: Historial<T>, actual: T): { h: Historial<T>; estado: T } | null {
    if (!h.atras.length) return null;
    const atras = h.atras.slice(0, -1);
    const estado = h.atras[h.atras.length - 1];
    return { h: { ...h, atras, adelante: [...h.adelante, actual] }, estado };
}

export function rehacer<T>(h: Historial<T>, actual: T): { h: Historial<T>; estado: T } | null {
    if (!h.adelante.length) return null;
    const adelante = h.adelante.slice(0, -1);
    const estado = h.adelante[h.adelante.length - 1];
    return { h: { ...h, atras: [...h.atras, actual], adelante }, estado };
}

/* ── Códigos ─────────────────────────────────────────────────────────────── */

export const HORARIO_ESTANDAR: Record<string, { startTime: string; endTime: string; hours: number; name: string }> = {
    M: { startTime: '07:00', endTime: '15:00', hours: 8, name: 'Mañana' },
    T: { startTime: '15:00', endTime: '23:00', hours: 8, name: 'Tarde' },
    N: { startTime: '23:00', endTime: '07:00', hours: 8, name: 'Noche' },
    D12: { startTime: '07:00', endTime: '19:00', hours: 12, name: 'Diurno 12h' },
    N12: { startTime: '19:00', endTime: '07:00', hours: 12, name: 'Nocturno 12h' },
};

export const CODIGOS_FRANCO = ['F', 'FF', 'FP'] as const;
export const CODIGOS_LICENCIA_RAPIDA: Record<string, string> = {
    V: 'Vacaciones',
    E: 'Enfermedad',
    A: 'ART',
    AA: 'Injustificada',
    L: 'Licencia Esp.',
    PG: 'PG Permiso Gremial',
};
export const CODIGOS_DESPLIEGUE = ['RET', 'REF', 'ESC'] as const;

export type TipoCodigo = 'FRANCO' | 'LICENCIA' | 'RET' | 'DESPLIEGUE' | 'TRABAJO';

export function tipoDeCodigo(code: string): TipoCodigo {
    const c = String(code || '').toUpperCase();
    if ((CODIGOS_FRANCO as readonly string[]).includes(c)) return 'FRANCO';
    if (CODIGOS_LICENCIA_RAPIDA[c]) return 'LICENCIA';
    if (c === 'RET') return 'RET';
    if (c === 'REF' || c === 'ESC') return 'DESPLIEGUE';
    return 'TRABAJO';
}

export type OpcionCodigo = { code: string; horario?: string; detalle?: string };

export function normalizarCodigo(texto: string): string {
    return String(texto || '').trim().toUpperCase().replace(/\s+/g, '');
}

/** Lista para el autocompletar: primero el exacto, después los que empiezan igual, sin repetir. */
export function sugerirCodigos(prefijo: string, opciones: OpcionCodigo[], max = 8): OpcionCodigo[] {
    const p = normalizarCodigo(prefijo);
    const vistos = new Set<string>();
    const unicas = opciones.filter((o) => {
        const k = o.code.toUpperCase();
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
    });
    if (!p) return unicas.slice(0, max);
    const exactas = unicas.filter((o) => o.code.toUpperCase() === p);
    const prefijos = unicas.filter((o) => o.code.toUpperCase() !== p && o.code.toUpperCase().startsWith(p));
    return [...exactas, ...prefijos].slice(0, max);
}

export type TurnoSla = { code: string; name?: string; hours?: number; startTime?: string; endTime?: string; positionName?: string };

export function horasEntre(startTime: string, endTime: string): number {
    const [h1, m1] = startTime.split(':').map(Number);
    const [h2, m2] = endTime.split(':').map(Number);
    if ([h1, m1, h2, m2].some((v) => Number.isNaN(v))) return 0;
    let min = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (min <= 0) min += 24 * 60;
    return Math.round((min / 60) * 100) / 100;
}

export type HorarioResuelto = {
    code: string;
    name: string;
    startTime: string;
    endTime: string;
    hours: number;
    positionName?: string;
    fuente: 'SLA' | 'ULTIMO' | 'ESTANDAR';
};

/**
 * Horario de un código de trabajo: el del SLA del puesto (o de otro puesto del SLA),
 * si no el estándar (M/T/N/D12/N12), si no el último usado para ese código en el objetivo.
 */
export function horarioDeCodigo(
    code: string,
    opts: { slaPuesto?: TurnoSla[]; slaTodos?: TurnoSla[]; ultimoUsado?: Record<string, { startTime: string; endTime: string; hours?: number; name?: string }> },
): HorarioResuelto | null {
    const c = normalizarCodigo(code);
    const del = (lista?: TurnoSla[]) => (lista || []).find((s) => normalizarCodigo(s.code) === c && s.startTime && s.endTime);
    const sla = del(opts.slaPuesto) || del(opts.slaTodos);
    if (sla) {
        return {
            code: c,
            name: sla.name || c,
            startTime: sla.startTime!,
            endTime: sla.endTime!,
            hours: Number(sla.hours) || horasEntre(sla.startTime!, sla.endTime!),
            positionName: sla.positionName,
            fuente: 'SLA',
        };
    }
    const est = HORARIO_ESTANDAR[c];
    if (est) return { code: c, ...est, fuente: 'ESTANDAR' };
    const ult = opts.ultimoUsado?.[c];
    if (ult) {
        return {
            code: c,
            name: ult.name || c,
            startTime: ult.startTime,
            endTime: ult.endTime,
            hours: Number(ult.hours) || horasEntre(ult.startTime, ult.endTime),
            fuente: 'ULTIMO',
        };
    }
    return null;
}

/** Códigos que se pueden escribir en una celda: SLA del puesto, el resto del SLA, estándar, francos, licencias y despliegue. */
export function opcionesDeCodigo(slaPuesto: TurnoSla[], slaTodos: TurnoSla[], ultimoUsado: Record<string, { startTime: string; endTime: string }> = {}): OpcionCodigo[] {
    const fmt = (s: TurnoSla) => (s.startTime && s.endTime ? `${s.startTime}–${s.endTime}` : undefined);
    const out: OpcionCodigo[] = [];
    for (const s of slaPuesto) out.push({ code: normalizarCodigo(s.code), horario: fmt(s), detalle: s.positionName ? `SLA · ${s.positionName}` : 'SLA' });
    for (const s of slaTodos) out.push({ code: normalizarCodigo(s.code), horario: fmt(s), detalle: s.positionName ? `SLA · ${s.positionName}` : 'SLA' });
    for (const [code, h] of Object.entries(HORARIO_ESTANDAR)) out.push({ code, horario: `${h.startTime}–${h.endTime}`, detalle: 'Estándar' });
    for (const [code, h] of Object.entries(ultimoUsado)) out.push({ code, horario: `${h.startTime}–${h.endTime}`, detalle: 'Usado en el objetivo' });
    out.push({ code: 'F', detalle: 'Franco' }, { code: 'FF', detalle: 'Franco feriado' }, { code: 'FP', detalle: 'Franco permuta' });
    out.push({ code: 'RET', detalle: 'Retén (stand-by)' }, { code: 'REF', detalle: 'Refuerzo' }, { code: 'ESC', detalle: 'Escuela' });
    for (const [code, name] of Object.entries(CODIGOS_LICENCIA_RAPIDA)) out.push({ code, detalle: `Licencia · ${name}` });
    return out;
}

/* ── Avisos que no frenan ────────────────────────────────────────────────── */

export type TurnoAviso = { code: string; startTime?: string; endTime?: string; hours?: number; trabajo: boolean };

export type AvisoRapido = {
    tipo: 'DESCANSO' | 'TOPE' | 'LICENCIA' | 'SOLAPE';
    empId: string;
    nombre: string;
    dateStr: string;
    texto: string;
    restHours?: number;
    monthHours?: number;
    cap?: number;
    code?: string;
};

const aMin = (hhmm?: string) => {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
};

/** Horas de descanso entre el turno del día i y el del día i+1 (con cruce de medianoche). */
export function descansoEntre(a: TurnoAviso, b: TurnoAviso): number | null {
    const sA = aMin(a.startTime);
    const eA = aMin(a.endTime);
    const sB = aMin(b.startTime);
    if (sA == null || eA == null || sB == null) return null;
    const finA = eA <= sA ? eA + 1440 : eA;
    const inicioB = sB + 1440;
    return Math.round(((inicioB - finA) / 60) * 10) / 10;
}

const fmtDia = (ds: string) => `${ds.slice(8, 10)}/${ds.slice(5, 7)}`;

/**
 * Avisos de la grilla en modo rápido. `turnoDe` devuelve lo que queda en la celda (guardado + pendiente).
 * Solo se evalúan las celdas tocadas (`claves`) y sus vecinas.
 */
export function avisosModoRapido(input: {
    filas: Array<{ id: string; nombre: string }>;
    dias: string[];
    claves: Set<string>;
    turnoDe: (empId: string, dateStr: string) => TurnoAviso | null;
    licenciaDe: (empId: string, dateStr: string) => string | null;
    ajenoDe: (empId: string, dateStr: string) => string | null;
    horasMes: (empId: string) => number;
    tope: number;
    topeAutorizado?: (empId: string) => boolean;
    descansoMin?: number;
}): AvisoRapido[] {
    const out: AvisoRapido[] = [];
    const minimo = input.descansoMin ?? 12;
    const tocados = new Set<string>();
    for (const k of input.claves) tocados.add(k.split('_')[0]);
    for (const fila of input.filas) {
        if (!tocados.has(fila.id)) continue;
        for (let i = 0; i < input.dias.length; i++) {
            const ds = input.dias[i];
            const key = `${fila.id}_${ds}`;
            const tocadaAca = input.claves.has(key);
            const tocadaSig = i + 1 < input.dias.length && input.claves.has(`${fila.id}_${input.dias[i + 1]}`);
            const t = input.turnoDe(fila.id, ds);
            if (tocadaAca && t?.trabajo) {
                const lic = input.licenciaDe(fila.id, ds);
                if (lic) out.push({ tipo: 'LICENCIA', empId: fila.id, nombre: fila.nombre, dateStr: ds, code: t.code, texto: `${fila.nombre} · ${fmtDia(ds)}: tiene ${lic} y se le cargó ${t.code}` });
                const aj = input.ajenoDe(fila.id, ds);
                if (aj) out.push({ tipo: 'SOLAPE', empId: fila.id, nombre: fila.nombre, dateStr: ds, code: t.code, texto: `${fila.nombre} · ${fmtDia(ds)}: ya tiene turno en ${aj}` });
            }
            if ((tocadaAca || tocadaSig) && t?.trabajo && i + 1 < input.dias.length) {
                const sig = input.turnoDe(fila.id, input.dias[i + 1]);
                if (sig?.trabajo) {
                    const h = descansoEntre(t, sig);
                    if (h != null && h < minimo) {
                        const dsSig = input.dias[i + 1];
                        out.push({
                            tipo: 'DESCANSO', empId: fila.id, nombre: fila.nombre, dateStr: dsSig, restHours: h, code: sig.code,
                            texto: `${fila.nombre} · ${fmtDia(ds)}→${fmtDia(dsSig)}: descanso ${String(h).replace('.', ',')} h (${t.code}→${sig.code})`,
                        });
                    }
                }
            }
        }
        const horas = input.horasMes(fila.id);
        if (horas > input.tope && !input.topeAutorizado?.(fila.id)) {
            const ultimo = [...input.claves].filter((k) => k.startsWith(`${fila.id}_`)).map((k) => k.split('_')[1]).sort().pop() || input.dias[0];
            out.push({ tipo: 'TOPE', empId: fila.id, nombre: fila.nombre, dateStr: ultimo, monthHours: Math.round(horas), cap: input.tope, texto: `${fila.nombre}: ${Math.round(horas)} h en el mes (tope ${input.tope} h)` });
        }
    }
    return out;
}

/** Al guardar: descanso < 8 h no se autoriza; 8–12 h y tope piden PIN una sola vez. */
export function autorizacionesAlGuardar(avisos: AvisoRapido[], minimoAbsoluto = 8) {
    const bloquean = avisos.filter((a) => a.tipo === 'DESCANSO' && (a.restHours ?? 0) < minimoAbsoluto);
    const piden = avisos.filter((a) => (a.tipo === 'DESCANSO' && (a.restHours ?? 0) >= minimoAbsoluto) || a.tipo === 'TOPE');
    return { bloquean, piden };
}

export const ATAJOS_MODO_RAPIDO: Array<{ teclas: string; que: string }> = [
    { teclas: 'Flechas · Tab · Enter', que: 'Mover la celda activa (Shift invierte)' },
    { teclas: 'Inicio / Fin', que: 'Primer / último día (Ctrl: primera / última celda)' },
    { teclas: 'Ctrl + flecha', que: 'Saltar al borde del bloque' },
    { teclas: 'Letra o número', que: 'Escribir un código (M, T, N, F, RET, V…); Enter, Tab o flecha confirma' },
    { teclas: '↑ ↓ en la lista', que: 'Elegir del autocompletar' },
    { teclas: 'Supr / Retroceso', que: 'Borrar la celda o el rango' },
    { teclas: 'Shift + flecha / clic / arrastre', que: 'Seleccionar un rango (lo que escribís va a todo el rango)' },
    { teclas: 'Ctrl + C / X / V', que: 'Copiar, cortar y pegar bloques (sirve entre guardias, objetivos y meses; pega desde Excel)' },
    { teclas: 'Ctrl + D / Ctrl + R', que: 'Rellenar hacia abajo / a la derecha' },
    { teclas: 'Cuadradito de la esquina', que: 'Arrastrar para repetir el patrón (sigue ciclos: M M M M M M F F)' },
    { teclas: 'Ctrl + Z / Ctrl + Y', que: 'Deshacer / rehacer' },
    { teclas: 'Ctrl + S', que: 'Guardar cronograma (borrador)' },
    { teclas: 'Esc', que: 'Cancelar lo escrito / quitar la selección' },
];
