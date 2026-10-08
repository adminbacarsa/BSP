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
