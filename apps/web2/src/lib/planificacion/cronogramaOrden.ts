import type { CronogramaEstado, CronogramaOverviewRow } from '@/lib/planificacion/planningCronogramaOverview';

/** Gravedad operativa: lo que pide acción primero; Publicado (al día) al final. */
export const GRAVEDAD_ESTADO: Record<CronogramaEstado, number> = {
  PUBLICADO_CON_CAMBIOS: 0,
  BORRADOR: 1,
  SIN_DATOS: 2,
  PUBLICADO: 3,
};

export type ColumnaOrdenCronograma =
  | 'cliente'
  | 'objetivo'
  | 'estado'
  | 'hs'
  | 'turnos'
  | 'coberturas'
  | 'publicado'
  | 'modificacion'
  | 'modificadoPor'
  | 'descanso'
  | 'armado';

export type DireccionOrden = 'asc' | 'desc';

export type OrdenCronograma = {
  columna: ColumnaOrdenCronograma;
  direccion: DireccionOrden;
};

const COLUMNAS = new Set<ColumnaOrdenCronograma>([
  'cliente', 'objetivo', 'estado', 'hs', 'turnos', 'coberturas',
  'publicado', 'modificacion', 'modificadoPor', 'descanso', 'armado',
]);

export const ORDEN_CRONOGRAMA_KEY = 'cosp-planif-cronogramas-orden';

export function agrupaPorCliente(orden: OrdenCronograma | null): boolean {
  return !orden || orden.columna === 'cliente';
}

/** Primera vez en una columna: texto y números de menor a mayor; la fecha, la más nueva primero. */
export function siguienteOrden(actual: OrdenCronograma | null, columna: ColumnaOrdenCronograma): OrdenCronograma {
  if (actual?.columna === columna) {
    return { columna, direccion: actual.direccion === 'asc' ? 'desc' : 'asc' };
  }
  return { columna, direccion: columna === 'modificacion' ? 'desc' : 'asc' };
}

function texto(a: string, b: string): number {
  return a.localeCompare(b, 'es', { sensitivity: 'base' });
}

/** El vacío queda al final en los dos sentidos. */
function conVacios(vacioA: boolean, vacioB: boolean, cmp: number, dir: DireccionOrden): number {
  if (vacioA && vacioB) return 0;
  if (vacioA) return 1;
  if (vacioB) return -1;
  return dir === 'asc' ? cmp : -cmp;
}

function fechaMs(d: Date | null | undefined): number | null {
  if (!d) return null;
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function comparar(
  a: CronogramaOverviewRow,
  b: CronogramaOverviewRow,
  orden: OrdenCronograma,
  horasDe: (r: CronogramaOverviewRow) => number,
): number {
  const dir = orden.direccion;
  switch (orden.columna) {
    case 'cliente':
      return conVacios(!a.clientName.trim(), !b.clientName.trim(), texto(a.clientName, b.clientName), dir);
    case 'objetivo':
      return conVacios(!a.objectiveName.trim(), !b.objectiveName.trim(), texto(a.objectiveName, b.objectiveName), dir);
    case 'estado': {
      const cmp = GRAVEDAD_ESTADO[a.estado] - GRAVEDAD_ESTADO[b.estado];
      return dir === 'asc' ? cmp : -cmp;
    }
    case 'hs': {
      const cmp = horasDe(a) - horasDe(b);
      return dir === 'asc' ? cmp : -cmp;
    }
    case 'turnos': {
      const cmp = a.totalShifts - b.totalShifts;
      return dir === 'asc' ? cmp : -cmp;
    }
    case 'coberturas': {
      const cmp = a.openVacancies - b.openVacancies;
      return dir === 'asc' ? cmp : -cmp;
    }
    case 'descanso': {
      const cmp = a.shortRestGaps - b.shortRestGaps;
      return dir === 'asc' ? cmp : -cmp;
    }
    case 'publicado': {
      const pa = a.publishedBy.trim() || (fechaMs(a.publishedAt) != null ? a.publishedAt!.toISOString() : '');
      const pb = b.publishedBy.trim() || (fechaMs(b.publishedAt) != null ? b.publishedAt!.toISOString() : '');
      return conVacios(!pa, !pb, texto(pa, pb), dir);
    }
    case 'modificacion':
      return conVacios(fechaMs(a.lastModifiedAt) == null, fechaMs(b.lastModifiedAt) == null, (fechaMs(a.lastModifiedAt) ?? 0) - (fechaMs(b.lastModifiedAt) ?? 0), dir);
    case 'modificadoPor':
      return conVacios(!a.lastModifiedBy.trim(), !b.lastModifiedBy.trim(), texto(a.lastModifiedBy, b.lastModifiedBy), dir);
    case 'armado': {
      const va = a.armado?.iniciadoAt ? a.armado.minutosActivos : null;
      const vb = b.armado?.iniciadoAt ? b.armado.minutosActivos : null;
      return conVacios(va == null, vb == null, (va ?? 0) - (vb ?? 0), dir);
    }
    default:
      return 0;
  }
}

export function ordenarFilasCronograma(
  rows: CronogramaOverviewRow[],
  orden: OrdenCronograma,
  horasDe: (r: CronogramaOverviewRow) => number = (r) => r.plannedHours,
): CronogramaOverviewRow[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => comparar(a.row, b.row, orden, horasDe) || a.i - b.i)
    .map((x) => x.row);
}

export function ordenarGruposPorCliente<T extends { clientName: string }>(
  groups: T[],
  direccion: DireccionOrden,
): T[] {
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      const cmp = conVacios(!a.g.clientName.trim(), !b.g.clientName.trim(), texto(a.g.clientName, b.g.clientName), direccion);
      return cmp || a.i - b.i;
    })
    .map((x) => x.g);
}

export function leerOrdenCronograma(): OrdenCronograma | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(ORDEN_CRONOGRAMA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { columna?: string; direccion?: string };
    if (!parsed || !COLUMNAS.has(parsed.columna as ColumnaOrdenCronograma)) return null;
    if (parsed.direccion !== 'asc' && parsed.direccion !== 'desc') return null;
    return { columna: parsed.columna as ColumnaOrdenCronograma, direccion: parsed.direccion };
  } catch {
    return null;
  }
}

export function guardarOrdenCronograma(orden: OrdenCronograma | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!orden) localStorage.removeItem(ORDEN_CRONOGRAMA_KEY);
    else localStorage.setItem(ORDEN_CRONOGRAMA_KEY, JSON.stringify(orden));
  } catch {
    /* cuota o modo privado */
  }
}
