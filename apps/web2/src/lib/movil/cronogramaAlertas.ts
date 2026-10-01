/**
 * CRONOGRAMA_SIN_PUBLICAR — lógica pura compartida por el escritorio (CC), Operación y
 * Planificación del celular. La novedad es de Planificación: Operación no la lista una por
 * una; como mucho una línea agrupada con las que cortan el servicio esa noche.
 *
 * El cron (`avisoCronogramaSinPublicar.ts`) escribe UNA por empresa, objetivo y mes
 * (`crono_sin_pub_{empresaId}_{objectiveId}_{yyyy-mm}`) y la actualiza cada tarde.
 */

export const CRONOGRAMA_SIN_PUBLICAR = 'CRONOGRAMA_SIN_PUBLICAR';

export type CronogramaNovedad = {
  id: string;
  type?: string;
  status?: string;
  objectiveId?: string | null;
  objectiveName?: string | null;
  clientId?: string | null;
  description?: string | null;
  corteHm?: string | null;
  mesKey?: string | null;
  dayYmd?: string | null;
  year?: number | null;
  month?: number | null;
  atendidaPor?: string | null;
};

export type CronogramaItem = {
  id: string;
  objectiveId: string;
  objectiveName: string;
  clientId: string | null;
  /** Hora a la que mañana se corta el servicio; null = no entra en operación. */
  corte: string | null;
  year: number;
  month: number;
  mesKey: string;
  descripcion: string;
};

export type CronogramaGrupo = {
  titulo: string;
  mesLabel: string;
  items: CronogramaItem[];
  ids: string[];
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const VISTA = new Set(['ATENDIDA', 'atendida']);

export function esCronogramaSinPublicar(n: { type?: string | null } | null | undefined): boolean {
  return String(n?.type || '') === CRONOGRAMA_SIN_PUBLICAR;
}

export function cronogramaVista(n: { status?: string | null } | null | undefined): boolean {
  return VISTA.has(String(n?.status || ''));
}

export function corteDe(n: CronogramaNovedad): string | null {
  if (n.corteHm && /^\d{2}:\d{2}$/.test(String(n.corteHm))) return String(n.corteHm);
  const m = /se corta a las (\d{2}:\d{2})/.exec(String(n.description || ''));
  return m ? m[1] : null;
}

export function mesDe(n: CronogramaNovedad): { mesKey: string; year: number; month: number; label: string } | null {
  let mesKey = String(n.mesKey || '');
  if (!/^\d{4}-\d{2}$/.test(mesKey)) {
    if (Number(n.year) > 0 && Number(n.month) > 0) mesKey = `${n.year}-${String(n.month).padStart(2, '0')}`;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(String(n.dayYmd || ''))) mesKey = String(n.dayYmd).slice(0, 7);
    else {
      // Legado: el texto dice «octubre sin cronograma» pero no el año; se infiere al día siguiente.
      const texto = String(n.description || '').toLowerCase();
      const idx = MESES.findIndex((mes) => texto.includes(`${mes} sin cronograma`));
      if (idx < 0) return null;
      const hoy = new Date();
      const year = idx + 1 < hoy.getMonth() + 1 ? hoy.getFullYear() + 1 : hoy.getFullYear();
      mesKey = `${year}-${String(idx + 1).padStart(2, '0')}`;
    }
  }
  const [year, month] = mesKey.split('-').map(Number);
  return { mesKey, year, month, label: MESES[month - 1] || mesKey };
}

export function itemDe(n: CronogramaNovedad): CronogramaItem | null {
  if (!esCronogramaSinPublicar(n) || !n.objectiveId) return null;
  const mes = mesDe(n);
  if (!mes) return null;
  return {
    id: n.id,
    objectiveId: String(n.objectiveId),
    objectiveName: String(n.objectiveName || n.objectiveId),
    clientId: n.clientId ? String(n.clientId) : null,
    corte: corteDe(n),
    year: mes.year,
    month: mes.month,
    mesKey: mes.mesKey,
    descripcion: String(n.description || ''),
  };
}

/** Pendientes (no vistas), una por objetivo-mes aunque el histórico tenga diarias duplicadas. */
export function pendientesCronograma(novedades: readonly CronogramaNovedad[]): CronogramaItem[] {
  const porClave = new Map<string, CronogramaItem>();
  for (const n of novedades) {
    if (cronogramaVista(n)) continue;
    const item = itemDe(n);
    if (!item) continue;
    const key = `${item.objectiveId}|${item.mesKey}`;
    const prev = porClave.get(key);
    if (!prev || prev.id < item.id) porClave.set(key, item);
  }
  return [...porClave.values()].sort((a, b) => a.objectiveName.localeCompare(b.objectiveName, 'es'));
}

/** Ids de TODAS las pendientes (incluye duplicados diarios) para «marcar todas». */
export function idsPendientesCronograma(novedades: readonly CronogramaNovedad[]): string[] {
  return novedades.filter((n) => esCronogramaSinPublicar(n) && !cronogramaVista(n)).map((n) => n.id);
}

/**
 * Operación: una sola línea, solo con las que cortan el servicio mañana.
 * Las de «no entra en operación» no se muestran: no hay guardias que operar.
 */
export function resumenCronogramaOperacion(novedades: readonly CronogramaNovedad[]): { texto: string; ids: string[] } | null {
  const cortan = pendientesCronograma(novedades).filter((item) => item.corte);
  if (cortan.length === 0) return null;
  const horas = [...new Set(cortan.map((item) => item.corte as string))].sort();
  const cuando = horas.length === 1 ? `a las ${horas[0]}` : `(${horas.join(', ')})`;
  const texto = cortan.length === 1
    ? `${cortan[0].objectiveName} corta mañana ${cuando} por falta de cronograma`
    : `${cortan.length} objetivos cortan mañana ${cuando} por falta de cronograma`;
  return { texto, ids: cortan.map((item) => item.id) };
}

/** Planificación: «15 objetivos sin cronograma de octubre», con la lista para publicar. */
export function agruparCronogramaPlanificacion(novedades: readonly CronogramaNovedad[]): CronogramaGrupo[] {
  const porMes = new Map<string, CronogramaItem[]>();
  for (const item of pendientesCronograma(novedades)) {
    const list = porMes.get(item.mesKey) || [];
    list.push(item);
    porMes.set(item.mesKey, list);
  }
  return [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mesKey, items]) => {
    const mesLabel = MESES[items[0].month - 1] || mesKey;
    const titulo = items.length === 1
      ? `${items[0].objectiveName} sin cronograma de ${mesLabel}`
      : `${items.length} objetivos sin cronograma de ${mesLabel}`;
    return { titulo, mesLabel, items, ids: items.map((item) => item.id) };
  });
}

/** Mismo parche que «Entendido» / «✕ todas» del escritorio: la novedad queda ATENDIDA. */
export function vistaPatch(actor: { actorName: string; uid: string | null }, at: unknown): Record<string, unknown> {
  return {
    status: 'ATENDIDA',
    atendidaAt: at,
    atendidaPor: actor.actorName,
    atendidaPorUid: actor.uid,
  };
}

export function linkPublicar(item: Pick<CronogramaItem, 'objectiveId' | 'clientId' | 'year' | 'month'>): string {
  const q = new URLSearchParams({ objectiveId: item.objectiveId, year: String(item.year), month: String(item.month) });
  if (item.clientId) q.set('clientId', item.clientId);
  return `/admin/planificacion/?${q.toString()}`;
}
