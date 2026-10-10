/**
 * Selección del modo rápido que no es un rectángulo: celdas sueltas y diagonal
 * (un guardia por día, una fila y un día por paso).
 */
import type { CeldaRC, Dimensiones } from './modoRapido';

export function claveCelda(c: CeldaRC): string {
  return `${c.r}:${c.c}`;
}

export function alternarCelda(lista: readonly CeldaRC[], celda: CeldaRC): CeldaRC[] {
  const k = claveCelda(celda);
  if (lista.some((c) => claveCelda(c) === k)) return lista.filter((c) => claveCelda(c) !== k);
  return [...lista, celda];
}

/**
 * Una celda por fila, avanzando un día por fila en el sentido del arrastre.
 * De (0,5) a (3,8) → 0:5, 1:6, 2:7, 3:8. De (0,8) a (3,5) → 0:8, 1:7, 2:6, 3:5.
 */
export function diagonal(desde: CeldaRC, hasta: CeldaRC, dims: Dimensiones): CeldaRC[] {
  const dr = Math.sign(hasta.r - desde.r) || 1;
  const dc = Math.sign(hasta.c - desde.c) || (dr > 0 ? 1 : -1);
  const out: CeldaRC[] = [];
  let r = desde.r;
  let c = desde.c;
  const pasos = Math.abs(hasta.r - desde.r);
  for (let i = 0; i <= pasos; i++) {
    if (r >= 0 && c >= 0 && r < dims.filas && c < dims.cols) out.push({ r, c });
    r += dr;
    c += dc;
  }
  return out;
}

export function unicas(celdas: readonly CeldaRC[]): CeldaRC[] {
  const vistos = new Set<string>();
  const out: CeldaRC[] = [];
  for (const c of celdas) {
    const k = claveCelda(c);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(c);
  }
  return out;
}

/** Pega la misma forma desde la celda activa: cada offset relativo a la primera celda copiada. */
export function pegarForma(
  origen: readonly CeldaRC[],
  valores: readonly string[],
  destino: CeldaRC,
  dims: Dimensiones,
): Array<{ r: number; c: number; valor: string }> {
  if (!origen.length) return [];
  const base = origen[0];
  const out: Array<{ r: number; c: number; valor: string }> = [];
  origen.forEach((c, i) => {
    const r = destino.r + (c.r - base.r);
    const col = destino.c + (c.c - base.c);
    if (r < 0 || col < 0 || r >= dims.filas || col >= dims.cols) return;
    out.push({ r, c: col, valor: valores[i] || '' });
  });
  return out;
}
