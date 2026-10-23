import type { ServicePosition } from '@/services/slaService';
import { isEventosPosition } from './eventosPosition';
import { computePositionDayComposition, WEEK_DAY_CODES } from './slaHoursCalculator';

const DIA_ORDEN = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

function paxEfectivo(quantity: number | null | undefined, posQty: number): number {
  const q = quantity != null ? Number(quantity) : posQty;
  return Math.max(0, Math.floor(Number(q) || 0));
}

function etiquetaDias(days: readonly string[]): string {
  const set = new Set(days.map((d) => String(d || '').toUpperCase()));
  const orden = DIA_ORDEN.filter((d) => set.has(d));
  if (orden.join('') === 'LMXJV') return 'L–V';
  if (orden.join('') === 'LMXJVS') return 'L–S';
  if (orden.length === 7) return 'L–D';
  return orden.join('·');
}

/** PAX de la tarjeta. En un custom es la suma del día más cargado (`quantity ?? puesto`). En 24 h, el PAX de la banda. */
export function formatPositionPaxLabel(pos: ServicePosition): string {
  if (isEventosPosition(pos)) return 'EXTRAS';
  const shifts = pos.allowedShiftTypes || [];
  const tipo = String(pos.coverageType || '').toLowerCase();
  if (tipo === 'custom' || tipo === 'encargado') {
    let max = 0;
    for (const d of DIA_ORDEN) {
      let n = 0;
      for (const s of shifts) {
        if (Array.isArray(s.specificDates) && s.specificDates.length > 0) continue;
        if (s.days?.length && !s.days.includes(d)) continue;
        n += paxEfectivo(s.quantity, pos.quantity);
      }
      if (n > max) max = n;
    }
    return `${max || pos.quantity || 0} PAX`;
  }
  const qtys = shifts
    .map((s) => (s.quantity != null ? Number(s.quantity) : null))
    .filter((q): q is number => q != null && q > 0);
  if (qtys.length === 0) return `${pos.quantity} PAX`;
  const mn = Math.min(...qtys);
  const mx = Math.max(...qtys);
  return mn === mx ? `${mn} PAX` : `${mn}–${mx} PAX`;
}

/** Horas del día. Si el puesto no corre todos los días, dice cuáles (L–V) en vez de «0–39». */
export function formatPositionDailyCoverageLabel(pos: ServicePosition): string {
  if (isEventosPosition(pos)) return '0 hs/día · extras TURA';
  const porDia = WEEK_DAY_CODES.map((d) => ({ d, h: computePositionDayComposition(pos, d).dayTotal }));
  const con = porDia.filter((x) => x.h > 1e-6);
  if (!con.length) return '—';
  const r = (x: number) => Math.round(x * 10) / 10;
  const min = Math.min(...con.map((x) => x.h));
  const max = Math.max(...con.map((x) => x.h));
  const horas = Math.abs(min - max) < 1e-6 ? `${r(max)} hs/día` : `${r(min)}–${r(max)} hs/día`;
  if (con.length === WEEK_DAY_CODES.length) return horas;
  return `${horas} · ${etiquetaDias(con.map((x) => x.d))}`;
}
