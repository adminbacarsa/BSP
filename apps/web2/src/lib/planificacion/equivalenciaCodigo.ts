/**
 * Equivalencia de un código de planilla (y su color) a una franja del servicio.
 * Si el objetivo tiene equivalencias, mandan sobre la normalización genérica.
 */

export type EquivalenciaCodigo = {
  clave: string;
  codigo: string;
  color: 'red' | 'none';
  code: string;
  startTime: string;
  endTime: string;
  muestras: number;
};

export function claveEquivalencia(codigo: string, rojo: boolean): string {
  const c = String(codigo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '').toUpperCase();
  return `${c}|${rojo ? 'red' : 'none'}`;
}

/** null = no hay tabla. Si hay tabla y el código no está, `code` queda null y se lista. */
export function resolverEquivalencia(
  raw: string,
  rojo: boolean,
  equivalencias: readonly EquivalenciaCodigo[] | null | undefined,
): { code: string | null; desconocido: string | null; aplicada: boolean } {
  const visible = String(raw || '').trim().replace(/\s+/g, ' ').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!equivalencias?.length) return { code: null, desconocido: null, aplicada: false };
  if (!visible) return { code: null, desconocido: null, aplicada: true };
  const compact = visible.replace(/[\s.\-]/g, '');
  const hit = equivalencias.find((e) => e.clave === claveEquivalencia(compact, rojo))
    || equivalencias.find((e) => e.clave === claveEquivalencia(compact, false) && !rojo);
  if (hit?.code) return { code: hit.code, desconocido: null, aplicada: true };
  return { code: null, desconocido: visible, aplicada: true };
}
