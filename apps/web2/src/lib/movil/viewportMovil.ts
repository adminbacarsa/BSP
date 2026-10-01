/**
 * Viewport del modo celular. En el celular el navegador no debe agrandar la pantalla
 * (doble toque, pellizco, zoom automático al enfocar un input) ni permitir scroll lateral.
 * El escritorio conserva su viewport de siempre.
 */
export const VIEWPORT_ESCRITORIO = 'width=device-width, initial-scale=1';
export const VIEWPORT_MOVIL = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';

/** Atributo en `<html>` que activa las reglas CSS del modo celular (`globals.css`). */
export const MOVIL_HTML_ATTR = 'data-movil';

/** Los inputs del celular no bajan de este tamaño: iPhone hace zoom si el input tiene menos de 16 px. */
export const MOVIL_INPUT_FONT_PX = 16;

export function metaViewport(movil: boolean): string {
  return movil ? VIEWPORT_MOVIL : VIEWPORT_ESCRITORIO;
}

export function aplicarModoMovilAlDocumento(movil: boolean, root: { setAttribute: (k: string, v: string) => void; removeAttribute: (k: string) => void } | null = typeof document === 'undefined' ? null : document.documentElement): void {
  if (!root) return;
  if (movil) root.setAttribute(MOVIL_HTML_ATTR, '1');
  else root.removeAttribute(MOVIL_HTML_ATTR);
}

/**
 * Ancho fijo más grande declarado en el markup (`w-[Npx]`, `min-w-[Npx]`, `w-N`, `min-w-N`
 * de Tailwind con N en unidades de 4 px, `width:Npx` inline). `max-w` no cuenta: acota, no empuja.
 */
export function anchoFijoMaximoPx(html: string): number {
  let max = 0;
  const px = /(?<![\w-])(?:min-)?w-\[(\d+(?:\.\d+)?)px\]/g;
  for (const m of html.matchAll(px)) max = Math.max(max, Number(m[1]));
  const tw = /(?<![\w-])(?:min-)?w-(\d+(?:\.\d+)?)(?=["\s])/g;
  for (const m of html.matchAll(tw)) max = Math.max(max, Number(m[1]) * 4);
  const inline = /width:\s*(\d+(?:\.\d+)?)px/g;
  for (const m of html.matchAll(inline)) max = Math.max(max, Number(m[1]));
  return max;
}

/** scrollWidth estimado del render: el viewport o el ancho fijo más grande, lo que sea mayor. */
export function scrollWidthEstimado(html: string, clientWidth: number): number {
  return Math.max(clientWidth, anchoFijoMaximoPx(html));
}

/**
 * El render entra en el viewport: el contenedor raíz corta el desborde lateral
 * (`overflow-x-hidden`) y ningún ancho fijo supera el ancho de pantalla.
 */
export function cabeEnViewport(html: string, clientWidth: number): boolean {
  return html.includes('overflow-x-hidden') && scrollWidthEstimado(html, clientWidth) <= clientWidth;
}
