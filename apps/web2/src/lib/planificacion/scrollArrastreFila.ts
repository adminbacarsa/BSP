/** Zona (px) del borde superior o inferior en la que el arrastre de una fila hace scroll. */
export const ZONA_SCROLL_FILA_PX = 60;
/** Tope de px por frame, en el borde. A 60 fps son ~960 px/s. */
export const MAX_SCROLL_FILA_PX = 16;

/**
 * Magnitud del scroll por frame según la distancia al borde.
 * 0 fuera de la zona. En el borde (0) y pasado el borde (negativo), el máximo.
 * Entre medio, proporcional a la cercanía.
 */
export function velocidadScrollBorde(
  distanciaAlBordePx: number,
  zonaPx = ZONA_SCROLL_FILA_PX,
  maxPx = MAX_SCROLL_FILA_PX,
): number {
  if (!Number.isFinite(distanciaAlBordePx) || !(zonaPx > 0) || !(maxPx > 0)) return 0;
  if (distanciaAlBordePx >= zonaPx) return 0;
  const adentro = Math.max(0, distanciaAlBordePx);
  return maxPx * (1 - adentro / zonaPx);
}

export type PasoScrollArrastre = { grilla: number; pagina: number };

/**
 * Delta por frame. Positivo = bajar. El encabezado sticky no cambia la cuenta:
 * el borde es el del contenedor visible. Si la grilla no tiene scroll propio
 * (está entera visible), el mismo delta va a la página.
 */
export function pasoScrollArrastre(input: {
  clientY: number;
  top: number;
  bottom: number;
  grillaPuedeScroll: boolean;
  zonaPx?: number;
  maxPx?: number;
}): PasoScrollArrastre {
  const cero: PasoScrollArrastre = { grilla: 0, pagina: 0 };
  const { clientY, top, bottom } = input;
  if (!Number.isFinite(clientY) || !Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) return cero;
  const zona = input.zonaPx ?? ZONA_SCROLL_FILA_PX;
  const max = input.maxPx ?? MAX_SCROLL_FILA_PX;
  const distTop = clientY - top;
  const distBottom = bottom - clientY;
  const enTop = distTop < zona;
  const enBottom = distBottom < zona;
  let dy = 0;
  if (enTop && enBottom) {
    if (distTop < distBottom) dy = -velocidadScrollBorde(distTop, zona, max);
    else if (distBottom < distTop) dy = velocidadScrollBorde(distBottom, zona, max);
  } else if (enTop) {
    dy = -velocidadScrollBorde(distTop, zona, max);
  } else if (enBottom) {
    dy = velocidadScrollBorde(distBottom, zona, max);
  }
  if (!dy) return cero;
  if (input.grillaPuedeScroll) return { grilla: dy, pagina: 0 };
  return { grilla: 0, pagina: dy };
}
