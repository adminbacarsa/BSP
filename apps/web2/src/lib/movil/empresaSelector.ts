/**
 * Selector de empresa del celular: la píldora de la barra superior abre una hoja con
 * la lista. Lógica pura (sin React) para poder probarla con `node`.
 */
export interface MovilEmpresaItem {
  id: string;
  name: string;
  /** Color de marca (`brandColor` / `primaryColor`); se muestra como punto. */
  color?: string | null;
  active?: boolean;
}

/** Con más de 6 empresas aparece el buscador. */
export const EMPRESAS_BUSCADOR_DESDE = 7;

export function empresaColor(hex: string | null | undefined): string | null {
  const value = String(hex || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

export function necesitaBuscador(total: number): boolean {
  return total >= EMPRESAS_BUSCADOR_DESDE;
}

function normalizar(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Empresas visibles: activas, ordenadas por nombre, filtradas por el buscador. La activa siempre queda. */
export function empresasVisibles(items: readonly MovilEmpresaItem[], activaId: string, busqueda = ''): MovilEmpresaItem[] {
  const needle = normalizar(busqueda);
  return items
    .filter((item) => item.active !== false || item.id === activaId)
    .filter((item) => !needle || normalizar(`${item.name} ${item.id}`).includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** El alto del selector de módulos vive en `menuLayout.ts` (tiles que ocupan la pantalla). */
export { MENU_FILA_PX, MENU_TILE_GAP_PX, MENU_TOPBAR_PX, altoMenuPx, menuCabeEnPantalla, tileAltoPx } from './menuLayout';
