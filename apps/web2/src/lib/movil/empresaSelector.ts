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

/** Alto del selector de módulos en px (390x844): todo tiene que entrar sin scroll. */
export const MENU_TOPBAR_PX = 48;
export const MENU_FECHA_PX = 20 + 4;
export const MENU_TILE_PX = 64;
export const MENU_TILE_GAP_PX = 8;
export const MENU_FILA_PX = 44;
export const MENU_PADDING_PX = 12 * 3 + 32;

export function altoMenuPx(modulos: number, filas = 3): number {
  const filasTiles = Math.ceil(modulos / 2);
  return MENU_TOPBAR_PX + MENU_FECHA_PX + filasTiles * MENU_TILE_PX + Math.max(0, filasTiles - 1) * MENU_TILE_GAP_PX + filas * MENU_FILA_PX + MENU_PADDING_PX;
}

export function menuCabeEnPantalla(modulos: number, altoPantallaPx = 844): boolean {
  return altoMenuPx(modulos) <= altoPantallaPx;
}
