/**
 * Un mes ya terminado (último día < hoy, hora Argentina) es solo lectura.
 * SuperAdmin en modo corrección puede tocarlo. El permiso `correct` de otros roles
 * vale solo mientras el mes sigue abierto.
 */

export const AVISO_MES_CERRADO = 'Mes cerrado';

export function ymdHoyAR(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** `month` es 1–12. */
export function ultimoDiaMes(year: number, month: number): string {
  const last = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  const dd = String(last).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

export function mesCerrado(year: number, month: number, now = new Date()): boolean {
  if (!year || !month) return false;
  return ultimoDiaMes(year, month) < ymdHoyAR(now);
}

export function mesDeFecha(fecha: string | null | undefined): { year: number; month: number } | null {
  const m = String(fecha || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) };
}

/**
 * Escritorio. `puedeCorrect` es el permiso PLANNING `correct` (no incluye el bypass de SuperAdmin).
 */
export function puedeEditarMesPlanificacion(input: {
  year: number;
  month: number;
  now?: Date;
  publicado: boolean;
  isSuperAdmin: boolean;
  correctionMode: boolean;
  puedeCorrect: boolean;
}): { cerrado: boolean; puedeEditar: boolean; motivo: 'abierto' | 'correccion' | 'mes_cerrado' | 'publicado' } {
  const cerrado = mesCerrado(input.year, input.month, input.now);
  if (cerrado) {
    if (input.isSuperAdmin && input.correctionMode) {
      return { cerrado: true, puedeEditar: true, motivo: 'correccion' };
    }
    return { cerrado: true, puedeEditar: false, motivo: 'mes_cerrado' };
  }
  if (!input.publicado) return { cerrado: false, puedeEditar: true, motivo: 'abierto' };
  if (input.correctionMode && (input.isSuperAdmin || input.puedeCorrect)) {
    return { cerrado: false, puedeEditar: true, motivo: 'correccion' };
  }
  return { cerrado: false, puedeEditar: false, motivo: 'publicado' };
}
