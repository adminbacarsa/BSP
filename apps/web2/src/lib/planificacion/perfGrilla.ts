/**
 * Medición de render + commit del planificador. Solo registra si alguien creó `window.__planifPerf = []`
 * (el script de medición); en uso normal es un `performance.now()` por render y nada más.
 */
export type MedicionCommit = { etiqueta: string; ms: number; at: number; celdas: number };

export function inicioRenderGrilla(): number {
    return typeof performance !== 'undefined' ? performance.now() : 0;
}

export function registrarCommitGrilla(inicio: number, etiqueta: string): void {
    if (typeof window === 'undefined') return;
    const destino = (window as unknown as { __planifPerf?: MedicionCommit[] }).__planifPerf;
    if (!Array.isArray(destino)) return;
    const ahora = performance.now();
    const celdas = document.querySelectorAll('[data-testid=grilla-celda]').length;
    destino.push({ etiqueta, ms: Math.round((ahora - inicio) * 100) / 100, at: ahora, celdas });
}

/** Tiempo por cálculo de la página: solo con el medidor prendido (`window.__planifSecciones`). */
export type SeccionMedida = { ms: number; n: number };
let ordenMemo = 0;

export function reiniciarOrdenMemo(): void {
    ordenMemo = 0;
}

export function medirSeccion<T>(nombre: string, fn: () => T): T {
    if (typeof window === 'undefined') return fn();
    const destino = (window as unknown as { __planifSecciones?: Record<string, SeccionMedida> }).__planifSecciones;
    if (!destino) return fn();
    const t = performance.now();
    try {
        return fn();
    } finally {
        const e = destino[nombre] || { ms: 0, n: 0 };
        e.ms += performance.now() - t;
        e.n += 1;
        destino[nombre] = e;
    }
}

/** useMemo que cronometra su cálculo: «#orden · comienzo del código» (en producción el código viene minificado, el orden ubica cuál es). */
export function crearUseMemoMedido(useMemoReact: <T>(f: () => T, deps: readonly unknown[] | undefined) => T) {
    return function useMemoMedido<T>(f: () => T, deps: readonly unknown[] | undefined): T {
        const orden = ++ordenMemo;
        return useMemoReact(() => medirSeccion(`#${orden} · ${String(f).replace(/\s+/g, ' ').slice(0, 70)}`, f), deps);
    };
}
