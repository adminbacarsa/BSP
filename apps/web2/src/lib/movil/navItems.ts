import {
  movilDestinoForPath,
  movilDestinosVisibles,
  type MovilDestino,
  type MovilDestinoId,
} from '@/lib/movil/destinos';

export type MovilModuleId = MovilDestinoId;

export interface MovilModule {
  id: MovilModuleId;
  label: string;
  desc: string;
  href: string;
  path: string;
  mobile: boolean;
}

type CanRead = (moduleKey: string) => boolean;
type Query = Record<string, string | string[] | undefined>;

function asModule(destino: MovilDestino): MovilModule {
  return {
    id: destino.id,
    label: destino.label,
    desc: destino.desc,
    href: destino.href,
    path: destino.path,
    mobile: destino.mobile,
  };
}

/** Grilla del selector, según permisos. El registro vive en `destinos.ts`. */
export function movilModulesForPermissions(canRead: CanRead, isSuperAdmin = false): MovilModule[] {
  return movilDestinosVisibles(canRead, isSuperAdmin).map(asModule);
}

export function movilModuleForPath(pathname: string, query?: Query): MovilModule | null {
  const destino = movilDestinoForPath(pathname, query);
  return destino ? asModule(destino) : null;
}

/** Rutas /admin/* con pantalla celular. El resto muestra «Disponible en la computadora». */
export function movilRouteHasMobileVersion(pathname: string): boolean {
  const path = String(pathname || '').replace(/\/$/, '');
  // La app de Supervisión de campo tiene su propia navegación.
  if (path.startsWith('/admin/supervision')) return true;
  const destino = movilDestinoForPath(path);
  return !!destino && destino.mobile;
}

export interface MovilNavItem {
  id: string;
  label: string;
  /** Vacío = no navega (Sala abre la hoja; Menú lo resuelve la barra). */
  href: string;
  sala?: boolean;
  alertas?: boolean;
  menu?: boolean;
}

function seccionHref(destino: MovilDestino, panel: string): string {
  const [base, raw] = destino.href.split('?');
  const params = new URLSearchParams(raw || '');
  if (panel) params.set('panel', panel);
  else params.delete('panel');
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * Barra del módulo actual: solo sus secciones y, al final, Menú.
 * Sin módulo (escritorio sin versión), la barra es solo Menú, que vuelve al selector.
 */
export function movilNavForPermissions(canRead: CanRead, pathname = '/admin/operaciones', query?: Query, isSuperAdmin = false): MovilNavItem[] {
  const visibles = movilDestinosVisibles(canRead, isSuperAdmin);
  const actual = movilDestinoForPath(pathname, query);
  const destino = actual && visibles.some((item) => item.id === actual.id) ? actual : null;
  const menu: MovilNavItem = { id: 'menu', label: 'Menú', href: '', menu: true };
  if (!destino) return [menu];
  const secciones: MovilNavItem[] = destino.secciones.map((seccion) => ({
    id: seccion.id,
    label: seccion.label,
    href: seccion.panel === 'sala' ? '' : seccionHref(destino, seccion.panel),
    sala: seccion.panel === 'sala',
    alertas: seccion.alertas === true,
  }));
  secciones.push(menu);
  return secciones;
}
