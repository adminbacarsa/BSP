/**
 * Selector de módulos del celular (`/admin/movil/`): los tiles OCUPAN la pantalla.
 * Grilla 2 columnas cuyo alto se reparte entre la barra, la fecha y las filas de abajo
 * (Asistente · Ver como escritorio · Cerrar sesión). Cada tile mide
 * (alto disponible) / filas, con mínimo 96 px y máximo 150 px. En 390x844 entra todo sin
 * scroll; en pantallas más bajas la grilla baja hasta el mínimo y la página hace scroll.
 * Lógica pura (sin React) para probarla con `node`.
 */

export const MENU_TOPBAR_PX = 48;
/** `pt-1` del contenido. */
export const MENU_PT_PX = 4;
export const MENU_FECHA_PX = 20;
/** `gap-3` entre fecha, grilla y filas (2 huecos). */
export const MENU_GAP_PX = 12;
export const MENU_FILA_PX = 44;
export const MENU_FILAS = 3;
/** `pb-8`. */
export const MENU_PB_PX = 32;
export const MENU_TILE_GAP_PX = 8;
export const MENU_TILE_MIN_PX = 96;
export const MENU_TILE_MAX_PX = 150;

/** Todo lo que no es grilla: barra, fecha, filas de abajo y espacios. */
export const MENU_FIJO_PX = MENU_TOPBAR_PX + MENU_PT_PX + MENU_FECHA_PX + MENU_GAP_PX * 2 + MENU_FILAS * MENU_FILA_PX + MENU_PB_PX;

export function filasTiles(modulos: number): number {
  return Math.max(1, Math.ceil(modulos / 2));
}

/** Alto de cada tile en px para una pantalla dada. */
export function tileAltoPx(altoPantallaPx: number, modulos: number): number {
  const filas = filasTiles(modulos);
  const disponible = altoPantallaPx - MENU_FIJO_PX - (filas - 1) * MENU_TILE_GAP_PX;
  const crudo = Math.floor(disponible / filas);
  return Math.min(MENU_TILE_MAX_PX, Math.max(MENU_TILE_MIN_PX, crudo));
}

/** Misma cuenta en CSS para que el navegador la haga con el alto real (`100dvh`). */
export function tileAltoCss(modulos: number): string {
  const filas = filasTiles(modulos);
  const fijo = MENU_FIJO_PX + (filas - 1) * MENU_TILE_GAP_PX;
  return `clamp(${MENU_TILE_MIN_PX}px, calc((100dvh - ${fijo}px) / ${filas}), ${MENU_TILE_MAX_PX}px)`;
}

/** Alto total del menú para esa pantalla (tiles ya repartidos). */
export function altoMenuPx(modulos: number, altoPantallaPx = 844): number {
  const filas = filasTiles(modulos);
  return MENU_FIJO_PX + filas * tileAltoPx(altoPantallaPx, modulos) + (filas - 1) * MENU_TILE_GAP_PX;
}

/** Sin scroll: el menú entra en la pantalla. Si no entra (tiles al mínimo), la página scrollea. */
export function menuCabeEnPantalla(modulos: number, altoPantallaPx = 844): boolean {
  return altoMenuPx(modulos, altoPantallaPx) <= altoPantallaPx;
}

// ── Línea de estado por módulo (dato real) ──

export type MenuTono = 'gris' | 'ambar' | 'rojo';

export interface MenuDatos {
  /** Novedades pendientes que el módulo reconoce (24 h). */
  alertas?: number;
  /** Guardias presentes ahora. */
  activos?: number;
  ausentesHoy?: number;
  /** Avisos del portal sin revisar + certificados en verificación. */
  porRevisar?: number;
  /** Turnos sin asignar hasta mañana. */
  huecos?: number;
  arcaPendientes?: number;
  /** Objetivos con CRONOGRAMA_SIN_PUBLICAR pendiente. */
  sinCronograma?: number;
  /** Objetivos en operación (Servicios). */
  enOperacion?: number;
}

export interface MenuEstado {
  texto: string;
  tono: MenuTono;
}

const n = (value: number | undefined): number => (Number.isFinite(value) ? Number(value) : 0);
const plural = (count: number, uno: string, varios: string): string => `${count} ${count === 1 ? uno : varios}`;

/**
 * «2 alertas · 6 activos», «3 huecos · 1 sin cronograma», «4 ausencias hoy», «2 ARCA pendientes».
 * Gris salvo que haya algo urgente (rojo en Operación, ámbar en el resto). `null` = sin dato aún.
 */
export function estadoModulo(id: string, datos: MenuDatos | null | undefined): MenuEstado | null {
  if (!datos) return null;
  switch (id) {
    case 'operacion':
    case 'supervision': {
      if (datos.activos === undefined && datos.alertas === undefined) return null;
      const partes: string[] = [];
      if (n(datos.alertas) > 0) partes.push(plural(n(datos.alertas), 'alerta', 'alertas'));
      if (datos.activos !== undefined) partes.push(plural(n(datos.activos), 'activo', 'activos'));
      if (partes.length === 0) partes.push('Sin alertas');
      return { texto: partes.join(' · '), tono: n(datos.alertas) > 0 ? 'rojo' : 'gris' };
    }
    case 'planificacion': {
      if (datos.huecos === undefined && datos.sinCronograma === undefined) return null;
      const partes: string[] = [];
      if (n(datos.huecos) > 0) partes.push(plural(n(datos.huecos), 'hueco', 'huecos'));
      if (n(datos.sinCronograma) > 0) partes.push(`${n(datos.sinCronograma)} sin cronograma`);
      if (partes.length === 0) partes.push('Al día');
      return { texto: partes.join(' · '), tono: partes[0] === 'Al día' ? 'gris' : 'ambar' };
    }
    case 'rrhh': {
      if (datos.ausentesHoy === undefined && datos.porRevisar === undefined) return null;
      const partes: string[] = [];
      if (n(datos.porRevisar) > 0) partes.push(plural(n(datos.porRevisar), 'por revisar', 'por revisar'));
      if (datos.ausentesHoy !== undefined) {
        const count = n(datos.ausentesHoy);
        partes.push(count > 0 ? plural(count, 'ausencia hoy', 'ausencias hoy') : 'Sin ausencias hoy');
      }
      if (partes.length === 0) return null;
      const tono = partes.length === 1 && partes[0] === 'Sin ausencias hoy' ? 'gris' : 'ambar';
      return { texto: partes.join(' · '), tono };
    }
    case 'eventuales': {
      if (datos.arcaPendientes === undefined) return null;
      const count = n(datos.arcaPendientes);
      return count > 0
        ? { texto: plural(count, 'ARCA pendiente', 'ARCA pendientes'), tono: 'ambar' }
        : { texto: 'Sin pendientes ARCA', tono: 'gris' };
    }
    case 'servicios': {
      if (datos.enOperacion === undefined) return null;
      return { texto: `${n(datos.enOperacion)} en operación`, tono: 'gris' };
    }
    default:
      return null;
  }
}

// ── Resumen de turnos para el menú (una sola consulta: ayer 14 h → fin de mañana) ──

export interface TurnoMenuLike {
  startTime?: number | null;
  isPresent?: boolean;
  isAbsent?: boolean;
  isCompleted?: boolean;
  realEndTime?: unknown;
  employeeId?: string | null;
  isUnassigned?: boolean;
  draft?: boolean;
  isFranco?: boolean;
  isVirtual?: boolean;
}

export function arYmd(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** Ventana de la consulta: 14 h hacia atrás (nocturnos en curso) y hasta el final de mañana. */
export const MENU_TURNOS_ATRAS_MS = 14 * 60 * 60 * 1000;
export const MENU_TURNOS_ADELANTE_MS = 2 * 24 * 60 * 60 * 1000;

export function resumenTurnosMenu(turnos: readonly TurnoMenuLike[], nowMs: number): { activos: number; ausentesHoy: number; huecos: number } {
  const hoy = arYmd(nowMs);
  let activos = 0;
  let ausentesHoy = 0;
  let huecos = 0;
  for (const t of turnos) {
    if (t.draft || t.isFranco || t.isVirtual) continue;
    const start = Number(t.startTime || 0);
    if (t.isPresent && !t.isCompleted && !t.realEndTime && !t.isAbsent) activos += 1;
    if (t.isAbsent && start > 0 && arYmd(start) === hoy) ausentesHoy += 1;
    const vacante = t.isUnassigned === true || String(t.employeeId || '').toUpperCase() === 'VACANTE';
    if (vacante && start >= nowMs - MENU_TURNOS_ATRAS_MS) huecos += 1;
  }
  return { activos, ausentesHoy, huecos };
}
