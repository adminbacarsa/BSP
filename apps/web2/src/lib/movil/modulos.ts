/**
 * Contrato del shell del celular. Cada módulo es autónomo: al entrar solo se ve
 * su barra (sus secciones + Menú) y sus alertas. Los módulos se registran acá
 * (`registrarModuloMovil`); la barra y el selector leen el registro.
 */
export type MovilModuloId = 'operacion' | 'supervision' | 'planificacion' | 'eventuales' | 'rrhh' | 'servicios';

export type MovilIcono = 'objetivos' | 'alertas' | 'sala' | 'dias' | 'huecos' | 'hoy' | 'cargar' | 'novedades' | 'bolsa' | 'arca' | 'alta' | 'lista' | 'menu';

export interface MovilSeccion {
  id: string;
  label: string;
  href: string;
  icono: MovilIcono;
  /** Valor de `?panel=` que marca esta sección activa; vacío = sin panel. */
  panel: string;
}

export interface MovilAlerta {
  type?: string | null;
  source?: string | null;
}

export interface MovilModulo {
  id: MovilModuloId;
  label: string;
  desc: string;
  href: string;
  /** Ruta base para saber si la pantalla actual pertenece al módulo. */
  path: string;
  /** Otras rutas que también son este módulo (ej. la página de escritorio que en el celular monta la pantalla básica). */
  alias?: string[];
  /** Query que distingue módulos que comparten ruta (ej. `modo=supervision`). */
  query?: Record<string, string>;
  /** false = todavía sin pantalla celular: la ruta muestra «Disponible en la computadora». Default true. */
  mobile?: boolean;
  /** Alcanza con permiso de lectura en uno de estos módulos. */
  moduleKeys: string[];
  secciones: MovilSeccion[];
  esAlertaDelModulo: (alerta: MovilAlerta) => boolean;
}

export interface MovilNavItem {
  id: string;
  label: string;
  href: string;
  icono: MovilIcono;
}

export const MOVIL_MENU_HREF = '/admin/movil/';

const ORDEN: MovilModuloId[] = ['operacion', 'supervision', 'planificacion', 'eventuales', 'rrhh', 'servicios'];
const registro = new Map<MovilModuloId, MovilModulo>();

export function registrarModuloMovil(modulo: MovilModulo): void {
  registro.set(modulo.id, modulo);
}

export function modulosRegistrados(): MovilModulo[] {
  return ORDEN.map((id) => registro.get(id)).filter((m): m is MovilModulo => !!m);
}

type CanRead = (moduleKey: string) => boolean;

/** Módulos que el usuario puede abrir. SuperAdmin ve todo. */
export function modulosMovil(canRead: CanRead, isSuperAdmin = false): MovilModulo[] {
  const todos = modulosRegistrados();
  if (isSuperAdmin) return todos;
  return todos.filter((m) => m.moduleKeys.some((key) => canRead(key)));
}

type Query = Record<string, string | string[] | undefined>;

function valor(query: Query | undefined, key: string): string {
  const raw = query?.[key];
  return Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
}

/** Módulo en el que está parada la pantalla. */
export function moduloMovilDe(pathname: string, query?: Query): MovilModulo | null {
  const path = String(pathname || '').replace(/\/$/, '');
  const matchea = (base: string) => path === base || path.startsWith(`${base}/`);
  const largo = (m: MovilModulo) => Math.max(...[m.path, ...(m.alias || [])].filter(matchea).map((p) => p.length));
  const candidatos = modulosRegistrados()
    .filter((m) => [m.path, ...(m.alias || [])].some(matchea))
    .sort((a, b) => largo(b) - largo(a));
  const conQuery = candidatos.find((m) => m.query && Object.entries(m.query).every(([k, v]) => valor(query, k) === v));
  if (conQuery) return conQuery;
  return candidatos.find((m) => !m.query) || candidatos[0] || null;
}

/** Barra inferior: solo las secciones del módulo + Menú. */
export function barraDelModulo(modulo: MovilModulo | null): MovilNavItem[] {
  const items: MovilNavItem[] = (modulo?.secciones || []).map((s) => ({ id: s.id, label: s.label, href: s.href, icono: s.icono }));
  items.push({ id: 'menu', label: 'Menú', href: MOVIL_MENU_HREF, icono: 'menu' });
  return items;
}

export function seccionActiva(modulo: MovilModulo | null, query?: Query): string {
  if (!modulo) return '';
  const panel = valor(query, 'panel');
  const hit = modulo.secciones.find((s) => s.panel === panel) || modulo.secciones.find((s) => !s.panel);
  return hit?.id || '';
}

export function filtrarAlertasDelModulo<T extends MovilAlerta>(modulo: MovilModulo | null, alertas: T[]): T[] {
  if (!modulo) return [];
  return alertas.filter((a) => modulo.esAlertaDelModulo(a));
}

/** Un solo módulo permitido: se entra directo y el menú no muestra la grilla. */
export function menuMovil(modulos: MovilModulo[]): { unico: MovilModulo | null; mostrarModulos: boolean } {
  return { unico: modulos.length === 1 ? modulos[0] : null, mostrarModulos: modulos.length > 1 };
}

/** Rutas /admin/* con pantalla celular. La app de Supervisión de campo tiene la suya. */
export function rutaTieneVersionMovil(pathname: string, query?: Query): boolean {
  const path = String(pathname || '').replace(/\/$/, '');
  if (path.startsWith('/admin/supervision') || path === '/admin/movil' || path.startsWith('/admin/movil/')) return true;
  const modulo = moduloMovilDe(path, query);
  return !!modulo && modulo.mobile !== false;
}

export function tipoAlerta(alerta: MovilAlerta): string {
  return String(alerta?.type || '').toUpperCase();
}
