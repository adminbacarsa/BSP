/** Paginación de alertas / notificaciones (puro). */

export const ALERTAS_PAGE_SIZE = 10;

export function paginateAlertItems<T>(items: T[], page: number, pageSize = ALERTAS_PAGE_SIZE): {
  pageItems: T[];
  safePage: number;
  totalPages: number;
  from: number;
  to: number;
  total: number;
} {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  const from = total === 0 ? 0 : start + 1;
  const to = Math.min(start + pageSize, total);
  return { pageItems, safePage, totalPages, from, to, total };
}
