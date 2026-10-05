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

/** Mes calendario en el que la grilla y el modal ya suman el tope (yyyy-mm). */
export function periodoTopeDeFecha(dateStr: string): string {
  const m = /^(\d{4}-\d{2})/.exec(String(dateStr || ''));
  return m ? m[1] : '';
}

export type TopeAutorizacion = {
  empleadoId: string;
  periodo: string;
  autorizadoPor: string;
  motivo: string;
  fecha: string;
  horasAlAutorizar: number;
  status: 'ACTIVE' | 'REVOKED';
};

/** Sin autorización vigente de ese mes, la asignación que pasa 200 h pide PIN. */
export function topeRequierePin(grant: TopeAutorizacion | null | undefined, periodo: string): boolean {
  if (!periodo) return true;
  if (!grant || grant.status !== 'ACTIVE' || grant.periodo !== periodo) return true;
  if (!String(grant.autorizadoPor || '').trim() || !String(grant.motivo || '').trim()) return true;
  return false;
}

export function textoAvisoTope(grant: TopeAutorizacion): string {
  const fecha = new Date(grant.fecha);
  const ddmm = Number.isNaN(fecha.getTime())
    ? (() => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(grant.fecha || ''));
        return m ? `${m[3]}/${m[2]}` : String(grant.fecha || '');
      })()
    : new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Argentina/Buenos_Aires',
        day: '2-digit',
        month: '2-digit',
      }).format(fecha);
  return `Tope 200 h autorizado por ${grant.autorizadoPor} el ${ddmm} (${grant.motivo})`;
}

export type AuthPedidoPin = {
  kind: 'DESCANSO' | 'TOPE';
  employeeId: string;
  dateStr: string;
};

/**
 * El tope vigente del mes no vuelve a pedir PIN. El descanso 8–12 h se pide en cada turno.
 */
export function clasificarPedidosPin(
  items: AuthPedidoPin[],
  grantOf: (employeeId: string, periodo: string) => TopeAutorizacion | null | undefined,
): { pedir: AuthPedidoPin[]; avisos: string[] } {
  const pedir: AuthPedidoPin[] = [];
  const avisos: string[] = [];
  const vistos = new Set<string>();
  for (const item of items) {
    if (item.kind === 'DESCANSO') {
      pedir.push(item);
      continue;
    }
    const periodo = periodoTopeDeFecha(item.dateStr);
    const grant = grantOf(item.employeeId, periodo);
    if (grant && !topeRequierePin(grant, periodo)) {
      const key = `${item.employeeId}|${periodo}`;
      if (!vistos.has(key)) {
        vistos.add(key);
        avisos.push(textoAvisoTope(grant));
      }
      continue;
    }
    pedir.push(item);
  }
  return { pedir, avisos };
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
