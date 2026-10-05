/**
 * Descanso entre jornadas y tope mensual que un supervisor puede autorizar.
 * ≥ 12 h y ≤ 200 h pasan. Entre 8 y 12 h, o más de 200 h, hace falta PIN y motivo.
 * Menos de 8 h no se autoriza.
 */

export const REST_OK_HOURS = 12;
export const REST_PIN_MIN_HOURS = 8;
export const MONTHLY_CAP_HOURS = 200;

export type RestBand = 'ok' | 'pin' | 'blocked';

export function classifyRestHours(gapHours: number): RestBand {
  if (!Number.isFinite(gapHours)) return 'blocked';
  if (gapHours + 1e-6 >= REST_OK_HOURS) return 'ok';
  if (gapHours + 1e-6 >= REST_PIN_MIN_HOURS) return 'pin';
  return 'blocked';
}

/** La banda con PIN aplica al descanso diario de 12 h. Un descanso largo (35 h) que no se cumple sigue bloqueado. */
export function classifyRestViolation(v: { gapHours?: number; requiredRestHours?: number } | null): RestBand {
  if (!v) return 'ok';
  const gap = v.gapHours;
  if (gap == null || !Number.isFinite(gap)) return 'blocked';
  const need = Number.isFinite(v.requiredRestHours!) ? v.requiredRestHours! : REST_OK_HOURS;
  if (gap + 1e-6 >= need) return 'ok';
  if (need <= REST_OK_HOURS + 0.05) return classifyRestHours(gap);
  return 'blocked';
}

export function monthNeedsSupervisorPin(monthHours: number, cap = MONTHLY_CAP_HOURS): boolean {
  return Number.isFinite(monthHours) && monthHours > cap + 0.05;
}

/** Milisegundos de descanso en el CC: null si alcanza, 'pin' entre 8 y 12 h, 'blocked' por debajo de 8 h. */
export function classifyRestMs(gapMs: number): RestBand {
  return classifyRestHours(gapMs / 3600000);
}

export type ShiftAuthMark = {
  descansoReducido?: boolean;
  topeExcedido?: boolean;
  descansoHoras?: number;
  horasMes?: number;
  autorizacionMotivo?: string;
};

/** Marca el turno del guardia que se autorizó. No pisa un borrado. */
export function stampShiftAuthMarks(
  changes: Record<string, any>,
  marks: Record<string, ShiftAuthMark>,
): Record<string, any> {
  const next = { ...changes };
  for (const [key, mark] of Object.entries(marks)) {
    const cur = next[key];
    if (!cur || cur.isDeleted) continue;
    next[key] = { ...cur, ...mark };
  }
  return next;
}
