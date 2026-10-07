/**
 * Copia de apps/mobile-guardia/src/lib/retencionTarjeta.ts — mantener iguales.
 * La app no puede importar functions (firebase-admin) y functions no puede
 * importar la app (el check standalone no resuelve fuera del paquete).
 */

export const TIPOS_NOTIF_RETENCION = ['RETENCION_AUTO', 'RETENCION_AVISO', 'RETENCION_MANUAL'] as const;
export const MOTIVO_RETENCION_TERMINADA = 'Retención terminada';

const CAP_MS = (12 * 60 + 59) * 60 * 1000;
const TZ = 'America/Argentina/Buenos_Aires';

export function aMs(value: unknown): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof value === 'object') {
    const o = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof o.toMillis === 'function') {
      const t = o.toMillis();
      return Number.isFinite(t) ? t : 0;
    }
    if (typeof o.toDate === 'function') {
      const t = o.toDate().getTime();
      return Number.isNaN(t) ? 0 : t;
    }
    const seconds = o.seconds ?? o._seconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) return seconds * 1000;
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

export function horaAr(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TZ,
  });
}

function turnoCerrado(shift: Record<string, unknown>): boolean {
  if (aMs(shift.realEndTime) > 0) return true;
  if (shift.isCompleted === true) return true;
  const status = String(shift.status || '').trim().toUpperCase();
  return status === 'COMPLETED' || status === 'FINALIZED' || status === 'FINALIZADO' || status === 'CERRADO';
}

function turnoAusente(shift: Record<string, unknown>): boolean {
  if (shift.isAbsent === true) return true;
  const status = String(shift.status || '').trim().toUpperCase();
  return status === 'ABSENT' || status === 'AUSENTE';
}

export function turnoMuestraTarjetaRetencion(shift: unknown, now = Date.now()): boolean {
  if (!shift || typeof shift !== 'object') return false;
  const row = shift as Record<string, unknown>;
  if (turnoCerrado(row) || turnoAusente(row)) return false;
  if (row.isRetention === true && row.isPresent === true) return true;
  const end = aMs(row.endTime);
  return row.isPresent === true && end > 0 && now >= end;
}

export function retencionTermino(before: unknown, after: unknown, now = Date.now()): boolean {
  if (!before || !turnoMuestraTarjetaRetencion(before, now)) return false;
  if (!after) return true;
  return !turnoMuestraTarjetaRetencion(after, now);
}

export type VistaRetencionHero = {
  lineaEstado: string | null;
  hace: string | null;
  espera: string;
  tope: string | null;
};

function textoHace(sinceMs: number, now: number): string {
  const min = Math.max(0, Math.floor((now - sinceMs) / 60000));
  if (min < 1) return 'hace menos de 1 min';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  if (rest === 0) return `hace ${h} h`;
  return `hace ${h} h ${String(rest).padStart(2, '0')} min`;
}

export function vistaRetencionHero(shift: unknown, now = Date.now()): VistaRetencionHero | null {
  if (!turnoMuestraTarjetaRetencion(shift, now)) return null;
  const row = shift as Record<string, unknown>;
  const fin = aMs(row.endTime);
  const since = aMs(row.retentionStartedAt) || fin;
  const start = aMs(row.checkInAt) || aMs(row.realStartTime) || aMs(row.startTime);
  const cap = start > 0 ? start + CAP_MS : 0;
  const quien = String(row.lateReliefIncomingName || '').trim();
  const eta = aMs(row.lateReliefEtaAt);
  const espera = quien
    ? eta > 0
      ? `Esperando a ${quien}, llega ~${horaAr(eta)}`
      : `Esperando a ${quien}`
    : 'sin relevo confirmado';
  const linea = [fin > 0 ? `terminó ${horaAr(fin)}` : '', since > 0 ? `retenido desde ${horaAr(since)}` : '']
    .filter(Boolean)
    .join(' · ');
  return {
    lineaEstado: linea || null,
    hace: since > 0 ? textoHace(since, now) : null,
    espera,
    tope: cap > 0 ? `podés quedarte hasta ${horaAr(cap)}` : null,
  };
}

export function textoTarjetaRetencion(shift: Record<string, unknown>): string {
  const since = aMs(shift.retentionStartedAt) || aMs(shift.endTime);
  const start = aMs(shift.checkInAt) || aMs(shift.realStartTime) || aMs(shift.startTime);
  const cap = start > 0 ? start + CAP_MS : 0;
  const quien = String(shift.lateReliefIncomingName || '').trim();
  const eta = aMs(shift.lateReliefEtaAt);
  const espera = quien
    ? eta > 0
      ? `Esperando a ${quien} (llega ${horaAr(eta)})`
      : `Esperando a ${quien}`
    : 'Esperá al relevo';
  const parts = ['⛔ Quedás retenido'];
  if (since > 0) parts.push(`desde ${horaAr(since)}`);
  parts.push(espera);
  if (cap > 0) parts.push(`tope ${horaAr(cap)}`);
  return parts.join(' · ');
}

export function textoVioRetencion(at: unknown): string | null {
  const ms = aMs(at);
  if (!ms) return null;
  return `vio la retención ${horaAr(ms)}`;
}

export function esNotifRetencion(type: unknown): boolean {
  return (TIPOS_NOTIF_RETENCION as readonly string[]).includes(String(type || '').trim().toUpperCase());
}

type NotifRetencion = {
  type?: unknown;
  shiftId?: unknown;
  turnoId?: unknown;
  closedAt?: unknown;
  closedMotivo?: unknown;
};

type ShiftRef = { id?: unknown };

export function notifRetencionEsHistorial(
  notif: NotifRetencion | null | undefined,
  shifts: readonly ShiftRef[] | null,
  now = Date.now(),
): boolean {
  if (!notif || !esNotifRetencion(notif.type)) return false;
  if (aMs(notif.closedAt) > 0 || String(notif.closedMotivo || '').trim()) return true;
  if (!shifts) return false;
  const id = String(notif.shiftId || notif.turnoId || '').trim();
  if (id) {
    const shift = shifts.find((row) => String(row?.id || '') === id);
    if (!shift) return false;
    return !turnoMuestraTarjetaRetencion(shift, now);
  }
  return !shifts.some((row) => turnoMuestraTarjetaRetencion(row, now));
}
