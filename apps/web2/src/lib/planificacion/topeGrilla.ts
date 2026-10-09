import { sumPublishedPlanHours } from '@cosp/hours-core';

export const TOPE_HORAS_GRILLA = 200;

export type CruceTope = {
  /** Primer día en que el acumulado del mes pasa el tope. */
  dateStr: string;
  /** Horas acumuladas al cerrar ese día. */
  acumuladas: number;
  /** Total del mes. */
  total: number;
};

function redondear(n: number): number {
  return Math.round((Number(n) || 0) * 10) / 10;
}

/**
 * Primer día cuyo acumulado supera el tope. Los días van en orden.
 * Una hora 0 (franco, licencia) no mueve el cruce.
 */
export function diaQuePasaElTope(
  dias: Array<{ dateStr: string; horas: number }>,
  tope = TOPE_HORAS_GRILLA,
): CruceTope | null {
  let acc = 0;
  let cruce: CruceTope | null = null;
  for (const d of dias) {
    const h = Number(d.horas) || 0;
    if (!(h > 0)) continue;
    acc = redondear(acc + h);
    if (!cruce && acc > tope) cruce = { dateStr: d.dateStr, acumuladas: acc, total: acc };
  }
  if (!cruce) return null;
  return { ...cruce, total: acc };
}

export function marcaTopeDesde(dateStr: string, cruce: string | null | undefined): boolean {
  return !!cruce && dateStr >= cruce;
}

export function textoTooltipCeldaTope(total: number): string {
  const n = redondear(total);
  const txt = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `Desde acá pasa las 200 h del mes (${txt} h)`;
}

export function textoTooltipFilaTope(cruce: CruceTope, autorizadoPor?: string): string {
  const ddmm = `${cruce.dateStr.slice(8)}/${cruce.dateStr.slice(5, 7)}`;
  const base = `Pasa el tope de 200 h el ${ddmm}`;
  const quien = String(autorizadoPor || '').trim();
  return quien ? `${base} · autorizado por ${quien}` : base;
}

/** Por legajo, el día en que las horas de la columna (la misma cuenta del mes) pasan el tope. */
export function cruceTopeDeTurnos(
  turnos: any[],
  ymd: (shift: any) => string,
  tope = TOPE_HORAS_GRILLA,
): Record<string, CruceTope> {
  const por = new Map<string, Map<string, any[]>>();
  for (const t of turnos || []) {
    const emp = String(t?.employeeId || '').trim();
    const dateStr = ymd(t);
    if (!emp || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    const dias = por.get(emp) || new Map<string, any[]>();
    const list = dias.get(dateStr) || [];
    list.push(t);
    dias.set(dateStr, list);
    por.set(emp, dias);
  }
  const out: Record<string, CruceTope> = {};
  for (const [emp, dias] of por) {
    const lista = [...dias.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dateStr, shifts]) => ({
        dateStr,
        horas: sumPublishedPlanHours(shifts, { anyDraftState: true }).hours,
      }));
    const cruce = diaQuePasaElTope(lista, tope);
    if (cruce) out[emp] = cruce;
  }
  return out;
}
