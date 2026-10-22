/** Qué filas y columnas hay que rearmar cuando cambia un turno. El resto de la grilla se reusa. */

export type AlcanceSucio = {
  empleados: Set<string>;
  dias: Set<string>;
  completo: boolean;
};

export function partirClaveGrilla(key: string): { empId: string; dateStr: string } | null {
  const base = key.endsWith('_B2') ? key.slice(0, -3) : key;
  if (base.length < 11) return null;
  const dateStr = base.slice(-10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const empId = base.slice(0, -11);
  if (!empId) return null;
  return { empId, dateStr };
}

export function clavesDistintas(
  prev: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): string[] {
  const a = prev || {};
  const b = next || {};
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(a)) {
    seen.add(key);
    if (a[key] !== b[key]) out.push(key);
  }
  for (const key of Object.keys(b)) {
    if (seen.has(key)) continue;
    if (a[key] !== b[key]) out.push(key);
  }
  return out;
}

export function alcanceDeClaves(claves: readonly string[]): AlcanceSucio {
  const empleados = new Set<string>();
  const dias = new Set<string>();
  for (const key of claves) {
    const p = partirClaveGrilla(key);
    if (!p) continue;
    empleados.add(p.empId);
    dias.add(p.dateStr);
  }
  return { empleados, dias, completo: false };
}

export function fusionarAlcance(partes: readonly AlcanceSucio[]): AlcanceSucio {
  const empleados = new Set<string>();
  const dias = new Set<string>();
  for (const p of partes) {
    if (p.completo) return { empleados: new Set(), dias: new Set(), completo: true };
    for (const e of p.empleados) empleados.add(e);
    for (const d of p.dias) dias.add(d);
  }
  return { empleados, dias, completo: false };
}

/** La celda se rearma si cambió su fila o su columna. */
export function celdaEnAlcance(empId: string, dateStr: string, alcance: AlcanceSucio): boolean {
  if (alcance.completo) return true;
  return alcance.empleados.has(empId) || alcance.dias.has(dateStr);
}

export function mismosRefs(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function mismosNumeros(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Pasa el borrador al mapa de turnos en un solo objeto.
 * Las claves que no están en el pendiente conservan la misma referencia.
 */
export function aplicarPendientesEnTurnos(
  prev: Record<string, any>,
  pending: Record<string, any>,
): Record<string, any> {
  let cambio = false;
  const next: Record<string, any> = { ...prev };
  for (const [key, change] of Object.entries(pending)) {
    if (!change || key.endsWith('_B2')) continue;
    if (change.isDeleted) {
      if (key in next) {
        delete next[key];
        cambio = true;
      }
      continue;
    }
    const base = prev[key];
    next[key] = base ? { ...base, ...change } : { ...change };
    cambio = true;
  }
  return cambio ? next : prev;
}
