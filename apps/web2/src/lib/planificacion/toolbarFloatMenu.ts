export type MenuAnchor = { top: number; left: number; right: number; bottom: number };

export type MenuPlace = { top: number; left: number; maxHeight: number };

/** Posición fixed del desplegable respecto del botón, volteando arriba o a la izquierda si no entra. */
export function placeToolbarMenu(input: {
  anchor: MenuAnchor;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  align?: 'start' | 'end';
  gap?: number;
  margin?: number;
}): MenuPlace {
  const gap = input.gap ?? 4;
  const margin = input.margin ?? 8;
  const { anchor, menuWidth, menuHeight } = input;
  const vw = input.viewportWidth;
  const vh = input.viewportHeight;

  let left = input.align === 'end' ? anchor.right - menuWidth : anchor.left;
  const maxLeft = vw - margin - menuWidth;
  if (left > maxLeft) left = maxLeft;
  if (left < margin) left = margin;

  const spaceBelow = vh - anchor.bottom - gap - margin;
  const spaceAbove = anchor.top - gap - margin;
  const openUp = menuHeight > spaceBelow && spaceAbove > spaceBelow;
  const room = Math.max(96, openUp ? spaceAbove : spaceBelow);
  const maxHeight = Math.min(menuHeight, room);
  let top = openUp ? anchor.top - gap - maxHeight : anchor.bottom + gap;
  if (top < margin) top = margin;
  if (top + maxHeight > vh - margin) top = Math.max(margin, vh - margin - maxHeight);
  return { top, left, maxHeight };
}

/** True si el menú cabe entero dentro del recuadro (lo recortaría un overflow). */
export function menuContainedInClip(
  menu: { top: number; left: number; width: number; height: number },
  clip: { top: number; left: number; right: number; bottom: number },
): boolean {
  return menu.left >= clip.left
    && menu.left + menu.width <= clip.right
    && menu.top >= clip.top
    && menu.top + menu.height <= clip.bottom;
}
