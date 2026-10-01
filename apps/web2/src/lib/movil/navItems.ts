import { barraDelModulo, moduloMovilDe, modulosMovil, type MovilNavItem } from './movilModulos';

export type { MovilNavItem } from './movilModulos';

type Query = Record<string, string | string[] | undefined>;

/**
 * Barra inferior del módulo actual: solo sus secciones + Menú.
 * Sin módulo en la ruta, se usa el primero permitido.
 */
export function movilNavForPermissions(
  canRead: (moduleKey: string) => boolean,
  pathname = '/admin/operaciones',
  query?: Query,
  isSuperAdmin = false,
): MovilNavItem[] {
  const permitidos = modulosMovil(canRead, isSuperAdmin);
  const actual = moduloMovilDe(pathname, query);
  const modulo = actual && permitidos.some((m) => m.id === actual.id) ? actual : permitidos[0] || null;
  return barraDelModulo(modulo);
}
